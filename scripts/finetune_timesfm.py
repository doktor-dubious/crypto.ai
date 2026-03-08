#!/usr/bin/env python3
"""Fine-tune TimesFM on sales data (pooled multi-series).

Reads per-outlet time series from the database, creates sliding-window
(context, target) training pairs, and runs continued pre-training.
Saves the result as a HuggingFace-compatible local checkpoint that the
TimesFMFinetunedEngine can load.

Incremental fine-tuning
-----------------------
The script automatically resumes from the output checkpoint when it
already exists. This lets you fine-tune in stages — by customer, by
date interval, or both — without losing previous progress:

    # Stage 1: first publication, 2018-2021
    uv run python scripts/finetune_timesfm.py \\
        --customer-ids <id1> --start-date 2018-01-01 --end-date 2021-12-31

    # Stage 2: same publication, 2022-2024 (resumes from stage 1 checkpoint)
    uv run python scripts/finetune_timesfm.py \\
        --customer-ids <id1> --start-date 2022-01-01 --end-date 2024-12-31

    # Stage 3: second publication, all dates (resumes from stage 2 checkpoint)
    uv run python scripts/finetune_timesfm.py \\
        --customer-ids <id2>

To start completely over: delete the output directory and re-run.

Options:
    --customer-ids TEXT     Comma-separated customer UUIDs to include
                            (default: all active customers)
    --start-date TEXT       Only include sales on or after this date YYYY-MM-DD
                            (default: all available history)
    --end-date TEXT         Only include sales on or before this date YYYY-MM-DD
                            (default: today)
    --context-length INT    Context window fed to the model per step
                            (default: 512)
    --horizon INT           Forecast horizon used as training target
                            (default: 7)
    --epochs INT            Training epochs over the loaded window set
                            (default: 3)
    --lr FLOAT              Learning rate — keep small to preserve
                            pre-trained knowledge (default: 1e-5)
    --batch-size INT        Training batch size (default: 32)
    --output TEXT           Checkpoint output directory
                            (default: models/timesfm_finetuned)
    --base-checkpoint TEXT  Base TimesFM HuggingFace repo or local path,
                            used only when no local checkpoint exists yet
                            (default: google/timesfm-2.5-200m-pytorch)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import date

import numpy as np
import torch
import torch.nn.functional as F
from torch.optim import AdamW
from torch.utils.data import DataLoader, Dataset

# ---------------------------------------------------------------------------
# Ensure src/ is on the path when running from the project root
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from sqlalchemy import select  # noqa: E402 (after sys.path edit)

from gorm_ai.database.connection import async_session_factory  # noqa: E402
from gorm_ai.database.models.customer import Customer  # noqa: E402
from gorm_ai.database.models.outlet import Outlet  # noqa: E402
from gorm_ai.logging import configure_logging  # noqa: E402
from gorm_ai.services.sales import SalesService  # noqa: E402

configure_logging()
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class SlidingWindowDataset(Dataset):
    """Generates (context, target) pairs by sliding a window over each series.

    Each pair consists of `context_length` observations followed by `horizon`
    observations used as the prediction target. Normalization (mean/std) is
    applied per context window so the model sees scale-invariant inputs,
    matching TimesFM's internal normalize_inputs=True behaviour.
    """

    def __init__(
        self,
        series_list: list[np.ndarray],
        context_length: int,
        horizon: int,
    ) -> None:
        self.context_length = context_length
        self.horizon = horizon
        self.windows: list[tuple[np.ndarray, np.ndarray]] = []

        for series in series_list:
            n = len(series)
            if n < context_length + horizon:
                continue
            for i in range(n - context_length - horizon + 1):
                ctx = series[i : i + context_length].astype(np.float32)
                tgt = series[i + context_length : i + context_length + horizon].astype(
                    np.float32
                )
                self.windows.append((ctx, tgt))

        log.info(
            "Dataset built: %d windows from %d series",
            len(self.windows),
            len(series_list),
        )

    def __len__(self) -> int:
        return len(self.windows)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        ctx, tgt = self.windows[idx]
        ctx_t = torch.from_numpy(ctx)
        tgt_t = torch.from_numpy(tgt)

        # Normalize with context statistics (scale-invariant training)
        mean = ctx_t.mean()
        std = ctx_t.std().clamp(min=1e-6)
        return (ctx_t - mean) / std, (tgt_t - mean) / std


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

async def _load_series_async(
    customer_ids: list[str] | None,
    outlet_ids_filter: list[str] | None,
    start_date: date | None,
    end_date: date | None,
    context_length: int,
    horizon: int,
) -> list[np.ndarray]:
    """Load outlet sales series from the database within the given date range."""
    min_length = context_length + horizon
    series_list: list[np.ndarray] = []

    async with async_session_factory() as session:
        if customer_ids:
            stmt = select(Customer).where(
                Customer.id.in_(customer_ids), Customer.active.is_(True)
            )
        else:
            stmt = select(Customer).where(Customer.active.is_(True))

        result = await session.execute(stmt)
        customers = list(result.scalars().all())
        log.info("Found %d customer(s) to process", len(customers))

        sales_service = SalesService(session)

        for customer in customers:
            outlet_stmt = select(Outlet.id).where(
                Outlet.customer_id == customer.id,
                Outlet.active.is_(True),
            )
            if outlet_ids_filter:
                outlet_stmt = outlet_stmt.where(Outlet.id.in_(outlet_ids_filter))
            result = await session.execute(outlet_stmt)
            outlet_ids = list(result.scalars().all())
            log.info("Customer %s — %d outlets", customer.id, len(outlet_ids))

            loaded = 0
            skipped = 0
            for outlet_id in outlet_ids:
                sales = await sales_service.get_by_date_range(
                    customer_id=customer.id,
                    outlet_id=outlet_id,
                    start_date=start_date,
                    end_date=end_date or date.today(),
                    apply_sales_filter=True,
                )
                if len(sales) < min_length:
                    skipped += 1
                    continue
                arr = np.array([float(s.sold) for s in sales], dtype=np.float32)
                series_list.append(arr)
                loaded += 1

            log.info(
                "Customer %s — loaded %d series, skipped %d (too short)",
                customer.id, loaded, skipped,
            )

    log.info("Total series loaded: %d", len(series_list))
    return series_list


def load_series(
    customer_ids: list[str] | None,
    outlet_ids_filter: list[str] | None,
    start_date: date | None,
    end_date: date | None,
    context_length: int,
    horizon: int,
) -> list[np.ndarray]:
    return asyncio.run(
        _load_series_async(
            customer_ids, outlet_ids_filter, start_date, end_date, context_length, horizon
        )
    )


# ---------------------------------------------------------------------------
# Model helpers
# ---------------------------------------------------------------------------

def get_trainable_module(model: object) -> torch.nn.Module:
    """Return the underlying nn.Module from a TimesFM wrapper.

    TimesFM 2.5 PyTorch wraps a plain nn.Module. This helper tries the
    attribute names used across known versions of the library. If none
    match, it raises a descriptive error so the user knows which
    attribute name to add here for their installed version.
    """
    for attr in ("_model", "model", "_tfm_model", "tfm_model", "_torch_model"):
        candidate = getattr(model, attr, None)
        if isinstance(candidate, torch.nn.Module):
            log.info("Found trainable nn.Module at model.%s", attr)
            return candidate

    attrs = [a for a in dir(model) if not a.startswith("__")]
    raise AttributeError(
        "Could not find the underlying nn.Module on the TimesFM wrapper. "
        f"Available attributes: {attrs}\n"
        "Add the correct attribute name to get_trainable_module() in this script."
    )


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train(
    model: object,
    series_list: list[np.ndarray],
    context_length: int,
    horizon: int,
    epochs: int,
    lr: float,
    batch_size: int,
) -> None:
    nn_module = get_trainable_module(model)

    # Patch size p must divide context_length evenly.
    p = nn_module.p
    o = nn_module.o   # output steps per patch
    q = nn_module.q   # quantile heads per output step

    if context_length % p != 0:
        adjusted = ((context_length // p) + 1) * p
        log.warning(
            "context_length %d is not divisible by patch size %d — adjusting to %d",
            context_length, p, adjusted,
        )
        context_length = adjusted

    dataset = SlidingWindowDataset(series_list, context_length, horizon)
    if len(dataset) == 0:
        log.error(
            "No training windows generated. "
            "All series may be shorter than context_length (%d) + horizon (%d) = %d days.",
            context_length, horizon, context_length + horizon,
        )
        sys.exit(1)

    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=0)

    nn_module.train()
    optimizer = AdamW(nn_module.parameters(), lr=lr)

    log.info(
        "Starting training — %d windows, patch_size=%d, batch_size=%d, epochs=%d, lr=%s",
        len(dataset), p, batch_size, epochs, lr,
    )

    for epoch in range(1, epochs + 1):
        epoch_loss = 0.0
        n_batches = 0

        for ctx_batch, tgt_batch in loader:
            # ctx_batch: (B, context_length) — pre-normalised by SlidingWindowDataset
            # tgt_batch: (B, horizon)        — same scale as ctx_batch
            B = ctx_batch.shape[0]
            optimizer.zero_grad()

            # Reshape flat context into patches: (B, num_patches, p)
            # Data is already (mean=0, std≈1) so no additional normalisation needed.
            patched = ctx_batch.reshape(B, -1, p)
            # All-False mask: True = masked/invalid, False = valid
            masks = torch.zeros_like(patched, dtype=torch.bool)

            # Forward pass (gradients enabled).
            # Returns ((input_emb, output_emb, output_ts, quantile_spread), caches)
            # output_ts shape: (B, num_patches, o * q)
            (_, _, output_ts, _), _ = nn_module(patched, masks)

            # Point forecast: last patch, first `horizon` output steps,
            # averaged across quantile heads → (B, horizon).
            # Both forecast and tgt_batch are in the same normalised space.
            forecast = output_ts.reshape(B, -1, o, q)[:, -1, :horizon, :].mean(dim=-1)

            loss = F.mse_loss(forecast, tgt_batch)
            loss.backward()
            optimizer.step()

            epoch_loss += loss.item()
            n_batches += 1

        avg_loss = epoch_loss / max(n_batches, 1)
        log.info("Epoch %d/%d — avg MSE loss: %.6f", epoch, epochs, avg_loss)

    nn_module.eval()
    log.info("Training complete.")


# ---------------------------------------------------------------------------
# Checkpoint saving
# ---------------------------------------------------------------------------

def save_checkpoint(model: object, output_dir: str) -> None:
    """Save the fine-tuned model to output_dir in HuggingFace format.

    Writes to a temporary directory first, then atomically replaces
    output_dir with a rename. This means an interrupted save never
    corrupts the previous good checkpoint — the old directory is only
    replaced once the new one is fully written.

    Tries model.save_pretrained() first (standard HuggingFace API).
    Falls back to saving the state_dict + copying config files from the
    HuggingFace cache so that from_pretrained(local_path) can load it.
    """
    import shutil
    import tempfile

    parent = os.path.dirname(os.path.abspath(output_dir))
    os.makedirs(parent, exist_ok=True)

    # Write to a sibling temp dir so the rename is on the same filesystem
    # (required for os.replace to be atomic on Linux).
    with tempfile.TemporaryDirectory(dir=parent, prefix=".tmp_checkpoint_") as tmp_dir:
        if hasattr(model, "save_pretrained"):
            model.save_pretrained(tmp_dir)
        else:
            # Fallback: state_dict + config files from HF cache
            nn_module = get_trainable_module(model)
            torch.save(nn_module.state_dict(), os.path.join(tmp_dir, "pytorch_model.bin"))
            try:
                from huggingface_hub import snapshot_download
                cache_dir = snapshot_download("google/timesfm-2.5-200m-pytorch")
                for fname in os.listdir(cache_dir):
                    if fname.endswith(".json"):
                        shutil.copy(os.path.join(cache_dir, fname), tmp_dir)
            except Exception as e:
                log.warning(
                    "Could not copy config files from HF cache (%s). "
                    "You may need to copy them manually for from_pretrained() to work.",
                    e,
                )

        # Atomically replace the output directory.
        # Move the old checkpoint aside first, swap in the new one, then remove old.
        old_dir = output_dir + ".old"
        if os.path.isdir(output_dir):
            os.rename(output_dir, old_dir)
        try:
            shutil.copytree(tmp_dir, output_dir)
        except Exception:
            # Restore previous checkpoint on failure
            if os.path.isdir(old_dir):
                os.rename(old_dir, output_dir)
            raise
        finally:
            if os.path.isdir(old_dir):
                shutil.rmtree(old_dir, ignore_errors=True)

    log.info("Checkpoint saved to '%s'", output_dir)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Fine-tune TimesFM 2.5 on pooled sales data.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument(
        "--customer-ids",
        default=None,
        help="Comma-separated customer UUIDs to include (default: all)",
    )
    p.add_argument(
        "--outlet-ids",
        default=None,
        help="Comma-separated outlet UUIDs to include; outlets not belonging "
             "to the specified customers are silently ignored (default: all)",
    )
    p.add_argument(
        "--start-date",
        default=None,
        metavar="YYYY-MM-DD",
        help="Only include sales on or after this date (default: all history)",
    )
    p.add_argument(
        "--end-date",
        default=None,
        metavar="YYYY-MM-DD",
        help="Only include sales on or before this date (default: today)",
    )
    p.add_argument("--context-length", type=int, default=512)
    p.add_argument("--horizon", type=int, default=7)
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--lr", type=float, default=1e-5)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--output", default="models/timesfm_finetuned")
    p.add_argument(
        "--base-checkpoint", default="google/timesfm-2.5-200m-pytorch",
        help="Used only when no local checkpoint exists yet",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    customer_ids = (
        [c.strip() for c in args.customer_ids.split(",")]
        if args.customer_ids
        else None
    )
    outlet_ids_filter = (
        [o.strip() for o in args.outlet_ids.split(",")]
        if args.outlet_ids
        else None
    )

    start_date: date | None = (
        date.fromisoformat(args.start_date) if args.start_date else None
    )
    end_date: date | None = (
        date.fromisoformat(args.end_date) if args.end_date else None
    )

    try:
        import timesfm
    except ImportError:
        log.error("timesfm package not found. Install it with: uv sync --extra dev")
        sys.exit(1)

    # Resume from existing local checkpoint if available; otherwise use base.
    if os.path.isdir(args.output):
        log.info(
            "Resuming from existing checkpoint: '%s' "
            "(delete this directory to start over from the base model)",
            args.output,
        )
        checkpoint = args.output
    else:
        log.info("No local checkpoint found — starting from base: %s", args.base_checkpoint)
        checkpoint = args.base_checkpoint

    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(checkpoint)
    model.compile(
        timesfm.ForecastConfig(
            max_context=1024,
            max_horizon=128,
            normalize_inputs=True,
            use_continuous_quantile_head=True,
            force_flip_invariance=True,
            infer_is_positive=True,
            fix_quantile_crossing=True,
            return_backcast=True,
        )
    )
    log.info("Model loaded from '%s'.", checkpoint)

    log.info(
        "Loading sales series — customers: %s, outlets: %s, dates: %s to %s",
        args.customer_ids or "all",
        args.outlet_ids or "all",
        start_date or "beginning",
        end_date or "today",
    )
    series_list = load_series(customer_ids, outlet_ids_filter, start_date, end_date, args.context_length, args.horizon)

    if not series_list:
        log.error(
            "No series loaded. Check your database connection and that "
            "sales data has been imported for the specified customers/dates."
        )
        sys.exit(1)

    train(
        model=model,
        series_list=series_list,
        context_length=args.context_length,
        horizon=args.horizon,
        epochs=args.epochs,
        lr=args.lr,
        batch_size=args.batch_size,
    )

    log.info("Saving checkpoint to '%s'...", args.output)
    save_checkpoint(model, args.output)
    log.info(
        "Done. To use the fine-tuned model pass \"engine\": \"timesfm_finetuned\" in your requests."
    )


if __name__ == "__main__":
    main()
