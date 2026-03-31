"""MOIRAI-2 fine-tuning runner (called by FinetuneService)."""

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

    def __len__(self):
        return len(self.windows)

    def __getitem__(self, idx):
        ctx, tgt = self.windows[idx]
        ctx_t = torch.from_numpy(ctx)
        tgt_t = torch.from_numpy(tgt)
        mean = ctx_t.mean()
        std = ctx_t.std().clamp(min=1e-6)
        return (ctx_t - mean) / std, (tgt_t - mean) / std


def _get_trainable_module(module):
    """Extract the underlying nn.Module from Moirai2Module."""
    if isinstance(module, torch.nn.Module):
        return module
    for attr in ("model", "_model", "backbone", "module"):
        candidate = getattr(module, attr, None)
        if isinstance(candidate, torch.nn.Module):
            return candidate
    raise AttributeError("Could not find nn.Module on Moirai2Module")


def _train_outlet(module, series: np.ndarray, context_length, horizon, epochs, lr, batch_size):
    nn_module = _get_trainable_module(module)

    dataset = _SlidingWindowDataset([series], context_length, horizon)
    if len(dataset) == 0:
        return False

    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=0)
    device = next(nn_module.parameters()).device
    nn_module.train()
    optimizer = AdamW(nn_module.parameters(), lr=lr)

    for epoch in range(1, epochs + 1):
        epoch_loss = 0.0
        n = 0

        for ctx_batch, tgt_batch in loader:
            ctx_batch = ctx_batch.to(device)
            tgt_batch = tgt_batch.to(device)
            bsz = ctx_batch.shape[0]
            optimizer.zero_grad()

            full_seq = torch.cat([ctx_batch, tgt_batch], dim=-1)
            full_seq_3d = full_seq.unsqueeze(-1)

            try:
                if hasattr(nn_module, "loss"):
                    loss = nn_module.loss(
                        target=full_seq_3d,
                        observed_mask=torch.ones_like(full_seq_3d, dtype=torch.bool),
                        prediction_mask=torch.cat([
                            torch.zeros(bsz, context_length, 1, dtype=torch.bool, device=device),
                            torch.ones(bsz, horizon, 1, dtype=torch.bool, device=device),
                        ], dim=1),
                    )
                    if isinstance(loss, dict):
                        loss = loss.get("loss", sum(loss.values()))
                elif hasattr(nn_module, "forward"):
                    out = nn_module(
                        target=full_seq_3d[:, :context_length],
                        observed_mask=torch.ones(bsz, context_length, 1, dtype=torch.bool, device=device),
                        prediction_mask=torch.ones(bsz, horizon, 1, dtype=torch.bool, device=device),
                    )
                    if isinstance(out, dict):
                        forecast = out.get("forecast", out.get("loc", out.get("mean")))
                    elif isinstance(out, (tuple, list)):
                        forecast = out[0]
                    else:
                        forecast = out
                    forecast = forecast.reshape(bsz, -1)[:, :horizon]
                    loss = fn.mse_loss(forecast, tgt_batch)
                else:
                    raise RuntimeError("No loss() or forward() on module")
            except (TypeError, RuntimeError):
                ctx_3d = ctx_batch.unsqueeze(-1)
                out = nn_module(ctx_3d)
                if isinstance(out, (tuple, list)):
                    out = out[0]
                if isinstance(out, dict):
                    out = out.get("forecast", out.get("loc", next(iter(out.values()))))
                forecast = out.reshape(bsz, -1)[:, :horizon]
                loss = fn.mse_loss(forecast, tgt_batch)

            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()
            n += 1

        logger.info("  Epoch %d/%d — avg MSE: %.6f", epoch, epochs, epoch_loss / max(n, 1))

    nn_module.eval()
    return True


def _save_checkpoint(module, output_dir):
    import shutil
    import tempfile

    parent = os.path.dirname(os.path.abspath(output_dir))
    os.makedirs(parent, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=parent, prefix=".tmp_ckpt_") as tmp:
        if hasattr(module, "save_pretrained"):
            module.save_pretrained(tmp)
        else:
            nn_module = _get_trainable_module(module)
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
    """Pull an existing checkpoint from the sync target before training."""
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
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=1200)
        logger.info("Pull complete.")
    except FileNotFoundError:
        logger.warning(
            "rsync not found — install rsync to enable checkpoint pull",
        )
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as e:
        logger.warning("Pull failed (will start from base model): %s", e)


def _sync_checkpoint(output_dir: str, sync_target: str) -> None:
    source = output_dir.rstrip("/") + "/"
    cmd = [
        "rsync", "-az", "--delete",
        "-e", "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30",
        source, sync_target,
    ]
    logger.info("Syncing checkpoint to %s ...", sync_target)
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=600)
        logger.info("Sync complete.")
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
    allow_new_checkpoint: bool = True,
) -> bool:
    """Fine-tune MOIRAI-2 on the provided outlet series."""
    from uni2ts.model.moirai2 import Moirai2Module

    # Set HF env
    from gorm_ai.config import get_settings
    s = get_settings()
    if s.hf_hub_cache:
        os.environ.setdefault("HF_HUB_CACHE", os.path.abspath(s.hf_hub_cache))
    if s.hf_token:
        os.environ.setdefault("HF_TOKEN", s.hf_token)

    # If we're on a remote worker with no local checkpoint, pull from the
    # sync target so we resume from the last fine-tuned weights.
    has_local = os.path.isdir(output_dir) and any(
        f.endswith((".safetensors", ".bin")) for f in os.listdir(output_dir)
    )
    if not has_local and sync_target:
        _pull_checkpoint(output_dir, sync_target)
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

    checkpoint = output_dir if has_local else "Salesforce/moirai-2.0-R-small"
    module = Moirai2Module.from_pretrained(checkpoint)
    logger.info("MOIRAI-2 loaded from '%s'", checkpoint)

    total = len(outlet_series)
    processed = 0

    for outlet_id, values in outlet_series.items():
        # Check for graceful stop request between outlets
        if should_stop and should_stop():
            logger.info("Graceful stop requested after %d/%d outlets", processed, total)
            if sync_target and processed > 0:
                _sync_checkpoint(output_dir, sync_target)
            return True

        series = np.array(values, dtype=np.float32)
        if len(series) < context_length + horizon:
            logger.info("  Outlet %s: too short (%d) — skipping", outlet_id, len(series))
            continue

        logger.info("  Training on outlet %s (%d points)", outlet_id, len(series))
        trained = await asyncio.get_event_loop().run_in_executor(
            None, _train_outlet, module, series, context_length, horizon, epochs, learning_rate, batch_size,
        )
        if trained:
            await asyncio.get_event_loop().run_in_executor(None, _save_checkpoint, module, output_dir)
            processed += 1
            if sync_target and processed % sync_every == 0:
                _sync_checkpoint(output_dir, sync_target)

        if on_outlet_done:
            await on_outlet_done(outlet_id, trained)

        pct = 5 + int(94 * (processed / max(total, 1)))
        if on_progress:
            await on_progress(pct, f"Trained {processed}/{total} outlets")

    if sync_target and processed > 0:
        _sync_checkpoint(output_dir, sync_target)
    logger.info("MOIRAI-2 fine-tuning done: %d/%d outlets trained", processed, total)
    return False
