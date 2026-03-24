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


def _train_outlet(model, series: np.ndarray, context_length, horizon, epochs, lr, batch_size):
    nn_module = _get_trainable_module(model)
    device = next(nn_module.parameters()).device
    p = nn_module.p
    o = nn_module.o
    q = nn_module.q

    if context_length % p != 0:
        context_length = ((context_length // p) + 1) * p

    dataset = _SlidingWindowDataset([series], context_length, horizon)
    if len(dataset) == 0:
        return False

    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=0)
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
            patched = ctx_batch.reshape(bsz, -1, p)
            masks = torch.zeros_like(patched, dtype=torch.bool)
            (_, _, output_ts, _), _ = nn_module(patched, masks)
            forecast = output_ts.reshape(bsz, -1, o, q)[:, -1, :horizon, :].mean(dim=-1)
            loss = fn.mse_loss(forecast, tgt_batch)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()
            n += 1
        logger.info("  Epoch %d/%d — avg MSE: %.6f", epoch, epochs, epoch_loss / max(n, 1))

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
    sync_target: str | None = None,
    sync_every: int = 5,
) -> None:
    """Fine-tune TimesFM on the provided outlet series."""
    import timesfm

    # Use local checkpoint only if it contains actual model files
    has_local = os.path.isdir(output_dir) and any(
        f.endswith((".safetensors", ".bin")) for f in os.listdir(output_dir)
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

    for outlet_id, values in outlet_series.items():
        series = np.array(values, dtype=np.float32)
        if len(series) < context_length + horizon:
            logger.info("  Outlet %s: too short (%d) — skipping", outlet_id, len(series))
            continue

        logger.info("  Training on outlet %s (%d points)", outlet_id, len(series))
        trained = await asyncio.get_event_loop().run_in_executor(
            None, _train_outlet, model, series, context_length, horizon, epochs, learning_rate, batch_size,
        )
        if trained:
            await asyncio.get_event_loop().run_in_executor(None, _save_checkpoint, model, output_dir)
            processed += 1
            if sync_target and processed % sync_every == 0:
                _sync_checkpoint(output_dir, sync_target)

        pct = 30 + int(60 * (processed / max(total, 1)))
        if on_progress:
            await on_progress(pct, f"Trained {processed}/{total} outlets")

    if sync_target and processed > 0:
        _sync_checkpoint(output_dir, sync_target)
    logger.info("TimesFM fine-tuning done: %d/%d outlets trained", processed, total)
