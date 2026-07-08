"""TimesFM fine-tuning runner (called by FinetuneService)."""

import asyncio
import logging
import os
import subprocess
from collections.abc import Awaitable, Callable

import numpy as np
import torch
import torch.nn.functional as fn
from torch.optim import AdamW
from torch.utils.data import DataLoader, Dataset

logger = logging.getLogger(__name__)


class _SlidingWindowDataset(Dataset):
    def __init__(self, series_list: list[np.ndarray], ctx_len: int, horizon: int):
        self.windows: list[tuple[np.ndarray, np.ndarray]] = []
        for s in series_list:
            n = len(s)
            if n < ctx_len + horizon:
                continue
            for i in range(n - ctx_len - horizon + 1):
                self.windows.append((
                    s[i:i + ctx_len].astype(np.float32),
                    s[i + ctx_len:i + ctx_len + horizon].astype(np.float32),
                ))

    @classmethod
    def from_windows(cls, windows: list[tuple[np.ndarray, np.ndarray]]) -> "_SlidingWindowDataset":
        """Build a dataset from a pre-sliced window list (e.g. a train/val split)."""
        obj = cls.__new__(cls)
        obj.windows = windows
        return obj

    def __len__(self):
        return len(self.windows)

    def __getitem__(self, idx):
        ctx, tgt = self.windows[idx]
        ctx_t = torch.from_numpy(ctx)
        tgt_t = torch.from_numpy(tgt)
        mean = ctx_t.mean()
        std = ctx_t.std().clamp(min=1e-6)
        return (ctx_t - mean) / std, (tgt_t - mean) / std


def _get_trainable_module(model):
    for attr in ("_model", "model", "_tfm_model", "tfm_model", "_torch_model"):
        candidate = getattr(model, attr, None)
        if isinstance(candidate, torch.nn.Module):
            return candidate
    raise AttributeError("Could not find nn.Module on TimesFM wrapper")


# If the best MSE across the first 5 epochs hasn't dropped below this,
# the outlet is pathological.  Well-behaved outlets reach <1.0 within
# a few epochs even when epoch 1 starts high (e.g. 200+).  Outlets
# that can't get below this threshold have data issues that would
# corrupt the shared model weights.
_DEFAULT_SANE_CHECK_EPOCHS = 5
_DEFAULT_MAX_SANE_LOSS = 10.0


def _forecast_batch(nn_module, ctx_batch, p, o, q, horizon):
    """Run TimesFM forward on a context batch and return the horizon forecast."""
    bsz = ctx_batch.shape[0]
    patched = ctx_batch.reshape(bsz, -1, p)
    masks = torch.zeros_like(patched, dtype=torch.bool)
    (_, _, output_ts, _), _ = nn_module(patched, masks)
    return output_ts.reshape(bsz, -1, o, q)[:, -1, :horizon, :].mean(dim=-1)


def _eval_avg_loss(nn_module, loader, p, o, q, horizon, device) -> float:
    """Average MSE over a loader with no gradient updates (held-out validation)."""
    nn_module.eval()
    total = 0.0
    n = 0
    with torch.no_grad():
        for ctx_batch, tgt_batch in loader:
            ctx_batch = ctx_batch.to(device)
            tgt_batch = tgt_batch.to(device)
            forecast = _forecast_batch(nn_module, ctx_batch, p, o, q, horizon)
            total += fn.mse_loss(forecast, tgt_batch).item()
            n += 1
    return total / max(n, 1)


def _train_outlet(
    model,
    series: np.ndarray,
    context_length,
    horizon,
    epochs,
    lr,
    batch_size,
    patience: int = 0,
    sane_check_epochs: int | None = None,
    max_sane_loss: float | None = None,
    early_stopping_method: str = "training",
    validation_split: float = 0.0,
):
    import copy

    sane_epochs = sane_check_epochs if sane_check_epochs is not None else _DEFAULT_SANE_CHECK_EPOCHS
    max_loss = max_sane_loss if max_sane_loss is not None else _DEFAULT_MAX_SANE_LOSS

    nn_module = _get_trainable_module(model)
    device = next(nn_module.parameters()).device
    p = nn_module.p
    o = nn_module.o
    q = nn_module.q

    if context_length % p != 0:
        context_length = ((context_length // p) + 1) * p

    full = _SlidingWindowDataset([series], context_length, horizon)
    if len(full) == 0:
        return False

    # Validation method: hold out the most-recent fraction of windows and
    # select/early-stop on their loss instead of the training loss, so the
    # "best epoch" reflects generalization rather than memorization.
    use_val = (
        early_stopping_method == "validation"
        and 0.0 < validation_split < 1.0
        and len(full) >= 2
    )
    if use_val:
        n_val = max(1, int(round(len(full) * validation_split)))
        n_val = min(n_val, len(full) - 1)  # always keep at least one training window
        train_ds = _SlidingWindowDataset.from_windows(full.windows[:-n_val])
        val_ds = _SlidingWindowDataset.from_windows(full.windows[-n_val:])
        logger.info(
            "  Validation early stopping: %d train / %d val (most recent) windows",
            len(train_ds), len(val_ds),
        )
    else:
        train_ds, val_ds = full, None

    loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = (
        DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=0)
        if val_ds is not None else None
    )

    # Snapshot weights so we can roll back if the outlet is pathological
    snapshot = copy.deepcopy(nn_module.state_dict())
    optimizer = AdamW(nn_module.parameters(), lr=lr)

    best_monitor = float("inf")   # best of the monitored metric (val or train)
    best_train = float("inf")     # best training loss (for the sane-check only)
    best_state = None
    stale = 0

    for epoch in range(1, epochs + 1):
        nn_module.train()
        epoch_loss = 0.0
        n = 0
        for ctx_batch, tgt_batch in loader:
            ctx_batch = ctx_batch.to(device)
            tgt_batch = tgt_batch.to(device)
            optimizer.zero_grad()
            forecast = _forecast_batch(nn_module, ctx_batch, p, o, q, horizon)
            loss = fn.mse_loss(forecast, tgt_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(nn_module.parameters(), 1.0)
            optimizer.step()
            epoch_loss += loss.item()
            n += 1
        train_avg = epoch_loss / max(n, 1)
        best_train = min(best_train, train_avg)

        # The monitored metric drives best-restore and early stopping.
        if val_loader is not None:
            val_avg = _eval_avg_loss(nn_module, val_loader, p, o, q, horizon, device)
            logger.info(
                "  Epoch %d/%d — train MSE: %.6f, val MSE: %.6f",
                epoch, epochs, train_avg, val_avg,
            )
            monitor = val_avg
        else:
            logger.info("  Epoch %d/%d — avg MSE: %.6f", epoch, epochs, train_avg)
            monitor = train_avg

        # Track the best epoch so the saved checkpoint is the best-scoring
        # weights, not whichever epoch we happen to stop on.
        if monitor < best_monitor:
            best_monitor = monitor
            best_state = copy.deepcopy(nn_module.state_dict())
            stale = 0
        else:
            stale += 1

        # Bail out on pathological outlets. Always judged on the *training*
        # loss, whose threshold is tuned for it.
        if epoch == sane_epochs and best_train > max_loss:
            logger.warning(
                "  Best train MSE after %d epochs is %.2f (threshold "
                "%.1f) — skipping series (restoring weights)",
                sane_epochs,
                best_train,
                max_loss,
            )
            nn_module.load_state_dict(snapshot)
            nn_module.eval()
            return False

        # Patience-based early stopping applies to the training-loss method
        # only; the validation method runs the full epoch budget and keeps the
        # best-validation epoch.
        if not use_val and patience > 0 and stale >= patience:
            logger.info(
                "  Early stopping at epoch %d "
                "(no improvement for %d epochs)",
                epoch,
                patience,
            )
            break

    # Restore the best-scoring epoch's weights rather than the last epoch's.
    if best_state is not None:
        nn_module.load_state_dict(best_state)
    nn_module.eval()
    return True


def _save_checkpoint(model, output_dir):
    import shutil
    import tempfile

    parent = os.path.dirname(os.path.abspath(output_dir))
    os.makedirs(parent, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=parent, prefix=".tmp_ckpt_") as tmp:
        if hasattr(model, "save_pretrained"):
            model.save_pretrained(tmp)
        else:
            nn_module = _get_trainable_module(model)
            torch.save(nn_module.state_dict(), os.path.join(tmp, "pytorch_model.bin"))

        old = output_dir + ".old"
        if os.path.isdir(output_dir):
            os.rename(output_dir, old)
        try:
            shutil.copytree(tmp, output_dir)
        except Exception:
            if os.path.isdir(old):
                os.rename(old, output_dir)
            raise
        finally:
            if os.path.isdir(old):
                shutil.rmtree(old, ignore_errors=True)


def _pull_checkpoint(output_dir: str, sync_target: str) -> None:
    """Pull an existing checkpoint from the sync target before training.

    This is the reverse of _sync_checkpoint: on a fresh remote worker the
    local ``output_dir`` is empty, so we pull from the server to resume
    from the last fine-tuned weights instead of starting from scratch.

    Raises RuntimeError on network/rsync failure. We never silently fall
    back to the base model after a failed pull, because that would
    overwrite the server's existing checkpoint on the next sync.
    """
    os.makedirs(output_dir, exist_ok=True)
    source = sync_target.rstrip("/") + "/"
    dest = output_dir.rstrip("/") + "/"
    cmd = [
        "rsync", "-az",
        "-e", "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30",
        source, dest,
    ]
    logger.info("Pulling checkpoint from %s ...", sync_target)
    try:
        subprocess.run(
            cmd, check=True, capture_output=True, text=True,
            timeout=1200,
        )
        logger.info("Pull complete.")
    except FileNotFoundError as e:
        raise RuntimeError(
            "rsync not found — cannot pull existing checkpoint. Install "
            "rsync on the worker or unset finetune_sync_target to allow "
            "training from base model.",
        ) from e
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as e:
        raise RuntimeError(
            f"Failed to pull existing checkpoint from {sync_target}: {e}. "
            "Aborting to avoid overwriting the server's checkpoint with a "
            "model trained from base. Retry once the server is reachable.",
        ) from e


def _sync_checkpoint(output_dir: str, sync_target: str) -> None:
    source = output_dir.rstrip("/") + "/"
    cmd = [
        "rsync", "-az", "--delete",
        "-e", "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30",
        source, sync_target,
    ]
    logger.info("Syncing checkpoint to %s ...", sync_target)
    try:
        subprocess.run(
            cmd, check=True, capture_output=True, text=True,
            timeout=1200,
        )
        logger.info("Sync complete.")
    except FileNotFoundError:
        logger.warning(
            "rsync not found — install rsync to enable checkpoint sync",
        )
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as e:
        logger.warning("Sync failed: %s", e)


async def run_finetune(
    outlet_series: dict[str, list[float]],
    context_length: int,
    horizon: int,
    epochs: int,
    learning_rate: float,
    batch_size: int,
    output_dir: str,
    on_progress: Callable[[int, str | None], Awaitable[None]] | None = None,
    on_outlet_done: Callable[[str, bool], Awaitable[None]] | None = None,
    sync_target: str | None = None,
    sync_every: int = 5,
    early_stopping_patience: int = 0,
    should_stop: Callable[[], bool] | None = None,
    sane_check_epochs: int | None = None,
    max_sane_loss: float | None = None,
    allow_new_checkpoint: bool = False,
    early_stopping_method: str = "training",
    validation_split: float = 0.0,
) -> dict:
    """Fine-tune TimesFM on the provided outlet series.

    Returns a dict with keys: stopped (bool), finetuned (int), pathological (int).
    """
    import timesfm

    # If we're on a remote worker with no local checkpoint, pull from the
    # sync target so we resume from the last fine-tuned weights.
    has_local = os.path.isdir(output_dir) and any(
        f.endswith((".safetensors", ".bin")) for f in os.listdir(output_dir)
    )
    if not has_local and sync_target:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _pull_checkpoint, output_dir, sync_target)
        has_local = os.path.isdir(output_dir) and any(
            f.endswith((".safetensors", ".bin")) for f in os.listdir(output_dir)
        )

    if not has_local and not allow_new_checkpoint:
        raise RuntimeError(
            "No existing checkpoint found and allow_new_checkpoint is disabled. "
            "Cannot start fine-tuning from the base model — this would overwrite "
            "a previously trained checkpoint on sync. Enable 'Allow New Checkpoint' "
            "in the engine settings to start from scratch.",
        )

    checkpoint = output_dir if has_local else "google/timesfm-2.5-200m-pytorch"
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(checkpoint)
    model.compile(timesfm.ForecastConfig(
        max_context=1024, max_horizon=128,
        normalize_inputs=True, use_continuous_quantile_head=True,
        force_flip_invariance=True, infer_is_positive=True,
        fix_quantile_crossing=True, return_backcast=True,
    ))
    logger.info("TimesFM loaded from '%s'", checkpoint)

    total = len(outlet_series)
    processed = 0
    pathological = 0
    idx = 0
    loop = asyncio.get_event_loop()

    for outlet_id, values in outlet_series.items():
        idx += 1

        # Check for graceful stop request between outlets
        if should_stop and should_stop():
            logger.info("Graceful stop requested after %d/%d series", processed, total)
            if sync_target and processed > 0:
                logger.info("  Final sync before stop...")
                await loop.run_in_executor(
                    None, _sync_checkpoint, output_dir, sync_target,
                )
            return {"stopped": True, "finetuned": processed, "pathological": pathological}

        series = np.array(values, dtype=np.float32)
        if len(series) < context_length + horizon:
            logger.info("  Series %s: too short (%d) — skipping", outlet_id, len(series))
            continue

        # Report progress before training so ETA tracks per-series, not just completions
        if on_progress:
            pct = 5 + int(94 * ((idx - 1) / max(total, 1)))
            await on_progress(pct, f"Training series {idx}/{total}")

        until_sync = sync_every - (processed % sync_every) if sync_target else 0
        logger.info(
            "  Training on series %s (%d points)%s",
            outlet_id,
            len(series),
            f" — {until_sync} series until next sync" if sync_target else "",
        )
        trained = await loop.run_in_executor(
            None,
            lambda: _train_outlet(
                model, series, context_length, horizon,
                epochs, learning_rate, batch_size,
                early_stopping_patience,
                sane_check_epochs, max_sane_loss,
                early_stopping_method, validation_split,
            ),
        )
        if trained:
            await loop.run_in_executor(
                None, _save_checkpoint, model, output_dir,
            )
            processed += 1
            if sync_target and processed % sync_every == 0:
                logger.info(
                    "  Syncing checkpoint (%d series trained)...",
                    processed,
                )
                await loop.run_in_executor(
                    None, _sync_checkpoint, output_dir, sync_target,
                )
        else:
            pathological += 1

        if on_outlet_done:
            await on_outlet_done(outlet_id, trained)

        pct = 5 + int(94 * (idx / max(total, 1)))
        if on_progress:
            await on_progress(pct, f"Trained {processed}/{total} series")

    if sync_target and processed > 0:
        logger.info("  Final sync after completion...")
        await loop.run_in_executor(
            None, _sync_checkpoint, output_dir, sync_target,
        )
    logger.info("TimesFM fine-tuning done: %d/%d series trained", processed, total)
    return {"stopped": False, "finetuned": processed, "pathological": pathological}
