#!/usr/bin/env python3
"""Fine-tune MOIRAI-2 on sales data (per-outlet, resumable).

Reads per-outlet time series from the database, creates sliding-window
(context, target) training pairs, and runs continued pre-training on the
Moirai2Module.  After every outlet the checkpoint is saved and a
``finetune_progress`` row is inserted so that a terminated process (e.g.
a spot instance being reclaimed) can restart and pick up where it left off.

Incremental fine-tuning
-----------------------
The script automatically resumes from the output checkpoint when it
already exists, **and** tracks each outlet's trained date range in the
``finetune_progress`` table (``data_start_date`` / ``data_end_date``).

On re-run, outlets that were previously fine-tuned will only be trained
on **new data** (from the day after ``data_end_date``).  If the new data
is too short (< context_length + horizon), the outlet is skipped.

    # First run — processes outlets A, B, C with all available data
    uv run python scripts/finetune_moirai2.py --customer-ids <id>

    # Spot instance reclaimed after outlet B.
    # Restart — skips A and B, continues from C.
    uv run python scripts/finetune_moirai2.py --customer-ids <id>

    # Later, new sales data arrives.  Re-run trains only on new data:
    uv run python scripts/finetune_moirai2.py --customer-ids <id>

Use ``--force`` to re-process outlets from scratch (ignores progress).

Options:
    --customer-ids TEXT       Comma-separated customer UUIDs to include
                              (default: all active customers)
    --outlet-group-ids TEXT   Comma-separated outlet group UUIDs; outlets
                              belonging to any of these groups are included
    --outlet-ids TEXT         Comma-separated outlet UUIDs to include
                              (default: all for the selected customers)
    --start-date TEXT         Only include sales on or after this date YYYY-MM-DD
                              (default: all available history)
    --end-date TEXT           Only include sales on or before this date YYYY-MM-DD
                              (default: today)
    --context-length INT      Context window fed to the model per step
                              (default: 512)
    --horizon INT             Forecast horizon used as training target
                              (default: 64)
    --epochs INT              Training epochs over the loaded window set
                              (default: 3)
    --lr FLOAT                Learning rate — keep small to preserve
                              pre-trained knowledge (default: 1e-5)
    --batch-size INT          Training batch size (default: 16)
    --output TEXT              Checkpoint output directory
                              (default: models/finetune/moirai)
    --base-checkpoint TEXT    Base MOIRAI-2 HuggingFace repo or local path,
                              used only when no local checkpoint exists yet
                              (default: Salesforce/moirai-2.0-R-small)
    --sync-target TEXT        rsync destination for checkpoint sync-back, e.g.
                              user@host:/path/to/models/finetune/moirai/
                              (default: $SYNC_TARGET env var, or disabled)
    --sync-every INT          Sync checkpoint back every N outlets
                              (default: $SYNC_EVERY env var, or 5)
    --force                   Re-process outlets already marked as done
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta

import numpy as np
import torch
import torch.nn.functional as fn
from torch.optim import AdamW
from torch.utils.data import DataLoader, Dataset

# ---------------------------------------------------------------------------
# Ensure src/ is on the path when running from the project root
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from sqlalchemy import delete, select  # noqa: E402

from gorm_ai.database.connection import async_session_factory  # noqa: E402
from gorm_ai.database.models.configuration import Configuration  # noqa: E402
from gorm_ai.database.models.customer import Customer  # noqa: E402
from gorm_ai.database.models.finetune_progress import FinetuneProgress  # noqa: E402
from gorm_ai.database.models.outlet import Outlet  # noqa: E402
from gorm_ai.database.models.outlet_group import OutletGroupMember  # noqa: E402
from gorm_ai.logging import configure_logging  # noqa: E402
from gorm_ai.services.sales import SalesService  # noqa: E402

configure_logging()
log = logging.getLogger(__name__)

ENGINE_NAME = "moirai2"
SINGLETON_ID = "00000000-0000-0000-0000-000000000001"


# ---------------------------------------------------------------------------
# Load system configuration from database
# ---------------------------------------------------------------------------

async def _load_db_config(session) -> Configuration | None:
    """Load the system configuration singleton."""
    result = await session.execute(
        select(Configuration).where(Configuration.id == SINGLETON_ID)
    )
    return result.scalar_one_or_none()


async def _load_engine_config(session, engine_slug: str):
    """Load the prediction engine row by slug."""
    from gorm_ai.database.models.prediction_engine import PredictionEngine as PredictionEngineModel
    result = await session.execute(
        select(PredictionEngineModel).where(
            PredictionEngineModel.slug == engine_slug,
            PredictionEngineModel.active.is_(True),
        )
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class SlidingWindowDataset(Dataset):
    """Generates (context, target) pairs by sliding a window over each series.

    Normalization (mean/std) is applied per context window so the model
    sees scale-invariant inputs.
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
# Data loading (single outlet)
# ---------------------------------------------------------------------------

async def _load_outlet_series(
    session,
    customer_id: str,
    outlet_id: str,
    start_date: date | None,
    end_date: date | None,
) -> np.ndarray | None:
    """Load sales series for a single outlet. Returns None if too few rows."""
    sales_service = SalesService(session)
    sales = await sales_service.get_by_date_range(
        customer_id=customer_id,
        outlet_id=outlet_id,
        start_date=start_date,
        end_date=end_date or date.today(),
        apply_sales_filter=True,
    )
    if not sales:
        return None
    return np.array([float(s.sold) for s in sales], dtype=np.float32)


# ---------------------------------------------------------------------------
# Progress helpers
# ---------------------------------------------------------------------------

async def _get_completed_outlets(session, engine: str) -> dict[str, FinetuneProgress]:
    """Return outlet IDs already marked as fine-tuned for this engine."""
    stmt = select(FinetuneProgress).where(
        FinetuneProgress.engine == engine,
        FinetuneProgress.active.is_(True),
    )
    result = await session.execute(stmt)
    return {row.outlet_id: row for row in result.scalars().all()}


async def _mark_outlet_done(
    session,
    outlet_id: str,
    customer_id: str,
    engine: str,
    context_length: int,
    horizon: int,
    epochs: int,
    data_start_date: date | None,
    data_end_date: date | None,
) -> None:
    """Insert or update a finetune_progress row for this outlet."""
    await session.execute(
        delete(FinetuneProgress).where(
            FinetuneProgress.outlet_id == outlet_id,
            FinetuneProgress.engine == engine,
        )
    )
    session.add(FinetuneProgress(
        outlet_id=outlet_id,
        customer_id=customer_id,
        engine=engine,
        completed_at=datetime.now(UTC),
        context_length=context_length,
        horizon=horizon,
        epochs=epochs,
        data_start_date=data_start_date,
        data_end_date=data_end_date,
    ))
    await session.commit()


# ---------------------------------------------------------------------------
# Outlet resolution
# ---------------------------------------------------------------------------

async def _resolve_outlets(
    session,
    customer_ids: list[str] | None,
    outlet_ids_filter: list[str] | None,
    outlet_group_ids: list[str] | None,
) -> list[tuple[str, str]]:
    """Return list of (customer_id, outlet_id) tuples to process."""
    if customer_ids:
        stmt = select(Customer).where(
            Customer.id.in_(customer_ids), Customer.active.is_(True)
        )
    else:
        stmt = select(Customer).where(Customer.active.is_(True))
    result = await session.execute(stmt)
    customers = list(result.scalars().all())
    log.info("Found %d customer(s) to process", len(customers))

    group_outlet_ids: set[str] | None = None
    if outlet_group_ids:
        stmt = select(OutletGroupMember.outlet_id).where(
            OutletGroupMember.group_id.in_(outlet_group_ids),
            OutletGroupMember.active.is_(True),
        )
        result = await session.execute(stmt)
        group_outlet_ids = set(result.scalars().all())
        log.info("Outlet groups resolved to %d outlet(s)", len(group_outlet_ids))

    pairs: list[tuple[str, str]] = []
    for customer in customers:
        outlet_stmt = select(Outlet.id).where(
            Outlet.customer_id == customer.id,
            Outlet.active.is_(True),
        )
        if outlet_ids_filter:
            outlet_stmt = outlet_stmt.where(Outlet.id.in_(outlet_ids_filter))
        if group_outlet_ids is not None:
            outlet_stmt = outlet_stmt.where(Outlet.id.in_(group_outlet_ids))

        result = await session.execute(outlet_stmt)
        for oid in result.scalars().all():
            pairs.append((customer.id, oid))

    log.info("Total outlets to consider: %d", len(pairs))
    return pairs


# ---------------------------------------------------------------------------
# Model helpers
# ---------------------------------------------------------------------------

def get_trainable_module(module: object) -> torch.nn.Module:
    """Return the underlying nn.Module from a Moirai2Module.

    Moirai2Module (uni2ts) wraps a HuggingFace PreTrainedModel which itself
    is an nn.Module. This helper locates it across uni2ts versions.
    """
    # Moirai2Module IS an nn.Module (it inherits from L.LightningModule)
    if isinstance(module, torch.nn.Module):
        log.info("Moirai2Module is directly an nn.Module")
        return module

    for attr in ("model", "_model", "backbone", "module"):
        candidate = getattr(module, attr, None)
        if isinstance(candidate, torch.nn.Module):
            log.info("Found trainable nn.Module at module.%s", attr)
            return candidate

    attrs = [a for a in dir(module) if not a.startswith("__")]
    raise AttributeError(
        "Could not find the underlying nn.Module on the Moirai2Module wrapper. "
        f"Available attributes: {attrs}\n"
        "Add the correct attribute name to get_trainable_module() in this script."
    )


# ---------------------------------------------------------------------------
# Training (single outlet)
# ---------------------------------------------------------------------------

def train(
    module: object,
    series_list: list[np.ndarray],
    context_length: int,
    horizon: int,
    epochs: int,
    lr: float,
    batch_size: int,
) -> None:
    """Fine-tune the Moirai2Module on sliding-window (context, target) pairs.

    MOIRAI-2 uses a masked encoder architecture. We feed the full
    context+horizon window and mask out the horizon portion, training the
    model to reconstruct it. If direct masking isn't feasible, we fall
    back to a simple MSE loss between the model's point forecast and the
    ground-truth horizon.
    """
    nn_module = get_trainable_module(module)

    dataset = SlidingWindowDataset(series_list, context_length, horizon)
    if len(dataset) == 0:
        log.warning("No training windows for this outlet — skipping.")
        return

    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=0)

    device = next(nn_module.parameters()).device
    nn_module.train()
    optimizer = AdamW(nn_module.parameters(), lr=lr)

    for epoch in range(1, epochs + 1):
        epoch_loss = 0.0
        n_batches = 0

        for ctx_batch, tgt_batch in loader:
            ctx_batch = ctx_batch.to(device)
            tgt_batch = tgt_batch.to(device)
            bsz = ctx_batch.shape[0]
            optimizer.zero_grad()

            # Build full sequence: context + target (the model will learn
            # to predict the target portion).
            full_seq = torch.cat([ctx_batch, tgt_batch], dim=-1)  # (B, C+H)

            # MOIRAI-2 expects (B, T, 1) for univariate
            full_seq_3d = full_seq.unsqueeze(-1)

            # Try the uni2ts training interface first; fall back to
            # a generic forward pass + MSE on the horizon.
            try:
                # uni2ts Moirai2Module exposes a loss() or training_step()
                # method when used as a LightningModule.
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
                    # Generic forward: pass context, get horizon prediction
                    out = nn_module(
                        target=full_seq_3d[:, :context_length],
                        observed_mask=torch.ones(bsz, context_length, 1, dtype=torch.bool, device=device),
                        prediction_mask=torch.ones(bsz, horizon, 1, dtype=torch.bool, device=device),
                    )
                    # Extract point forecast from output
                    if isinstance(out, dict):
                        forecast = out.get("forecast", out.get("loc", out.get("mean")))
                    elif isinstance(out, (tuple, list)):
                        forecast = out[0]
                    else:
                        forecast = out

                    if forecast is None:
                        raise RuntimeError("Could not extract forecast from model output")

                    # Reshape forecast to match target
                    forecast = forecast.reshape(bsz, -1)[:, :horizon]
                    loss = fn.mse_loss(forecast, tgt_batch)
                else:
                    raise RuntimeError("Module has no loss() or forward() method")

            except (TypeError, RuntimeError) as e:
                if n_batches == 0 and epoch == 1:
                    log.warning(
                        "Advanced training interface failed (%s); "
                        "falling back to GluonTS predict-and-compare loop.",
                        e,
                    )
                # Fallback: use a simple forward approach
                # Feed context through the module and compare output to target
                ctx_3d = ctx_batch.unsqueeze(-1)  # (B, C, 1)
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
            n_batches += 1

        avg_loss = epoch_loss / max(n_batches, 1)
        log.info("  Epoch %d/%d — avg MSE loss: %.6f", epoch, epochs, avg_loss)

    nn_module.eval()


# ---------------------------------------------------------------------------
# Checkpoint saving
# ---------------------------------------------------------------------------

def save_checkpoint(module: object, output_dir: str) -> None:
    """Save the fine-tuned model to output_dir.

    Writes to a temporary directory first, then atomically replaces
    output_dir with a rename.
    """
    import shutil
    import tempfile

    parent = os.path.dirname(os.path.abspath(output_dir))
    os.makedirs(parent, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=parent, prefix=".tmp_checkpoint_") as tmp_dir:
        if hasattr(module, "save_pretrained"):
            module.save_pretrained(tmp_dir)
        else:
            nn_module = get_trainable_module(module)
            torch.save(nn_module.state_dict(), os.path.join(tmp_dir, "pytorch_model.bin"))

        old_dir = output_dir + ".old"
        if os.path.isdir(output_dir):
            os.rename(output_dir, old_dir)
        try:
            shutil.copytree(tmp_dir, output_dir)
        except Exception:
            if os.path.isdir(old_dir):
                os.rename(old_dir, output_dir)
            raise
        finally:
            if os.path.isdir(old_dir):
                shutil.rmtree(old_dir, ignore_errors=True)

    log.info("Checkpoint saved to '%s'", output_dir)


# ---------------------------------------------------------------------------
# Sync checkpoint back to production server
# ---------------------------------------------------------------------------

def sync_checkpoint(output_dir: str, sync_target: str) -> None:
    """rsync the checkpoint directory to the production server."""
    source = output_dir.rstrip("/") + "/"
    cmd = [
        "rsync", "-az", "--delete",
        "-e", "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30",
        source, sync_target,
    ]
    log.info("Syncing checkpoint to %s ...", sync_target)
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=600)
        log.info("Sync complete.")
    except subprocess.TimeoutExpired:
        log.warning("Sync timed out after 600s — will retry next interval.")
    except subprocess.CalledProcessError as e:
        log.warning("Sync failed (rc=%d): %s", e.returncode, e.stderr.strip())


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Fine-tune MOIRAI-2 on sales data (per-outlet, resumable).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument(
        "--customer-ids",
        default=None,
        help="Comma-separated customer UUIDs to include (default: all)",
    )
    p.add_argument(
        "--outlet-group-ids",
        default=None,
        help="Comma-separated outlet group UUIDs; only outlets in these groups are included",
    )
    p.add_argument(
        "--outlet-ids",
        default=None,
        help="Comma-separated outlet UUIDs to include (default: all)",
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
    p.add_argument("--horizon", type=int, default=64)
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--lr", type=float, default=1e-5)
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--output", default="models/finetune/moirai")
    p.add_argument(
        "--base-checkpoint", default="Salesforce/moirai-2.0-R-small",
        help="Used only when no local checkpoint exists yet",
    )
    p.add_argument(
        "--sync-target",
        default=os.environ.get("SYNC_TARGET"),
        help="rsync destination for checkpoint sync-back "
             "(default: $SYNC_TARGET env var, or disabled)",
    )
    p.add_argument(
        "--sync-every",
        type=int,
        default=int(os.environ.get("SYNC_EVERY", "5")),
        help="Sync checkpoint back every N outlets (default: $SYNC_EVERY or 5)",
    )
    p.add_argument(
        "--force", action="store_true",
        help="Re-process outlets already marked as fine-tuned",
    )
    return p.parse_args()


# ---------------------------------------------------------------------------
# Main (async core)
# ---------------------------------------------------------------------------

async def _main_async(args: argparse.Namespace) -> None:
    # ── Load configuration from DB ──────────────────────────────────────
    async with async_session_factory() as session:
        db_config = await _load_db_config(session)
        engine_config = await _load_engine_config(session, ENGINE_NAME)

    effective_output = args.output
    effective_sync_every = args.sync_every

    if db_config:
        log.info("Loaded system configuration from database")
        if effective_output == "models/finetune/moirai" and db_config.finetuned_model_path:
            effective_output = db_config.finetuned_model_path
        if effective_sync_every == int(os.environ.get("SYNC_EVERY", "5")) and db_config.finetune_sync_every:
            effective_sync_every = db_config.finetune_sync_every

    if engine_config:
        log.info("Loaded engine configuration for '%s'", ENGINE_NAME)
        if engine_config.finetuned_model_path:
            effective_output = engine_config.finetuned_model_path
        if engine_config.finetune_sync_every is not None:
            effective_sync_every = engine_config.finetune_sync_every
    else:
        log.info("No engine configuration found for '%s' — using global/CLI defaults", ENGINE_NAME)

    log.info("  Model path: %s", effective_output)
    log.info("  Sync every: %d outlets", effective_sync_every)

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
    outlet_group_ids = (
        [g.strip() for g in args.outlet_group_ids.split(",")]
        if args.outlet_group_ids
        else None
    )
    start_date: date | None = (
        date.fromisoformat(args.start_date) if args.start_date else None
    )
    end_date: date | None = (
        date.fromisoformat(args.end_date) if args.end_date else None
    )

    try:
        from uni2ts.model.moirai2 import Moirai2Module
    except ImportError:
        log.error("uni2ts package not found. Install it with: uv sync --extra moirai")
        sys.exit(1)

    # Resolve outlets and determine per-outlet start dates
    async with async_session_factory() as session:
        all_pairs = await _resolve_outlets(
            session, customer_ids, outlet_ids_filter, outlet_group_ids,
        )

        if args.force:
            completed: dict[str, FinetuneProgress] = {}
            log.info("--force: will re-process all outlets")
        else:
            completed = await _get_completed_outlets(session, ENGINE_NAME)
            if completed:
                log.info("Found %d already-completed outlet(s)", len(completed))

    pairs: list[tuple[str, str, date | None]] = []
    for cid, oid in all_pairs:
        prev = completed.get(oid)
        if prev is not None and not args.force:
            if prev.data_end_date is not None:
                effective_start = prev.data_end_date + timedelta(days=1)
                if start_date and start_date > effective_start:
                    effective_start = start_date
                log.info(
                    "Outlet %s: incremental fine-tune from %s (previously trained up to %s)",
                    oid, effective_start, prev.data_end_date,
                )
                pairs.append((cid, oid, effective_start))
            else:
                log.info("Outlet %s: already completed (no date info) — skipping", oid)
                continue
        else:
            pairs.append((cid, oid, start_date))

    if not pairs:
        log.info("All outlets already processed. Use --force to re-run.")
        return

    log.info(
        "Processing %d outlet(s) — customers: %s, dates: %s to %s",
        len(pairs),
        args.customer_ids or "all",
        start_date or "beginning",
        end_date or "today",
    )

    # Resume from existing local checkpoint if available; otherwise use base.
    if os.path.isdir(effective_output):
        log.info(
            "Resuming from existing checkpoint: '%s' "
            "(delete this directory to start over from the base model)",
            effective_output,
        )
        checkpoint = effective_output
    else:
        log.info("No local checkpoint found — starting from base: %s", args.base_checkpoint)
        checkpoint = args.base_checkpoint

    # Set HF cache if configured
    from gorm_ai.config import get_settings
    s = get_settings()
    if s.hf_hub_cache:
        os.environ.setdefault("HF_HUB_CACHE", os.path.abspath(s.hf_hub_cache))
    if s.hf_token:
        os.environ.setdefault("HF_TOKEN", s.hf_token)

    module = Moirai2Module.from_pretrained(checkpoint)
    log.info("MOIRAI-2 module loaded from '%s'.", checkpoint)

    min_length = args.context_length + args.horizon
    processed = 0
    skipped = 0
    failed = 0

    for idx, (customer_id, outlet_id, effective_start) in enumerate(pairs, 1):
        log.info(
            "[%d/%d] Outlet %s (customer %s) — data from %s",
            idx, len(pairs), outlet_id, customer_id,
            effective_start or "beginning",
        )
        try:
            async with async_session_factory() as session:
                series = await _load_outlet_series(
                    session, customer_id, outlet_id, effective_start, end_date,
                )

            if series is None or len(series) < min_length:
                log.info("  Skipped — too short (%d < %d)",
                         len(series) if series is not None else 0, min_length)
                skipped += 1
                continue

            train(
                module=module,
                series_list=[series],
                context_length=args.context_length,
                horizon=args.horizon,
                epochs=args.epochs,
                lr=args.lr,
                batch_size=args.batch_size,
            )

            save_checkpoint(module, effective_output)

            prev = completed.get(outlet_id)
            record_start = (
                prev.data_start_date
                if prev and prev.data_start_date
                else effective_start
            )
            record_end = end_date or date.today()

            async with async_session_factory() as session:
                await _mark_outlet_done(
                    session, outlet_id, customer_id, ENGINE_NAME,
                    args.context_length, args.horizon, args.epochs,
                    data_start_date=record_start,
                    data_end_date=record_end,
                )

            processed += 1
            log.info("  Done (%d/%d processed)", processed, len(pairs))

            if args.sync_target and processed % effective_sync_every == 0:
                sync_checkpoint(effective_output, args.sync_target)

        except Exception:
            failed += 1
            log.exception("  Failed on outlet %s — continuing", outlet_id)

    log.info(
        "Finished. Processed: %d, skipped (short): %d, failed: %d",
        processed, skipped, failed,
    )
    if processed > 0:
        if args.sync_target:
            sync_checkpoint(effective_output, args.sync_target)
        log.info("Fine-tuned MOIRAI-2 checkpoint saved to '%s'.", effective_output)


def main() -> None:
    args = parse_args()
    asyncio.run(_main_async(args))


if __name__ == "__main__":
    main()
