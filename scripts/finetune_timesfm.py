#!/usr/bin/env python3
"""Fine-tune TimesFM on sales data (per-outlet, resumable).

Reads per-outlet time series from the database, creates sliding-window
(context, target) training pairs, and runs continued pre-training on each
outlet individually.  After every outlet the checkpoint is saved and a
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
    uv run python scripts/finetune_timesfm.py --customer-ids <id>

    # Spot instance reclaimed after outlet B.
    # Restart — skips A and B, continues from C.
    uv run python scripts/finetune_timesfm.py --customer-ids <id>

    # Later, new sales data arrives.  Re-run trains only on new data:
    uv run python scripts/finetune_timesfm.py --customer-ids <id>

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
                              (default: 7)
    --epochs INT              Training epochs over the loaded window set
                              (default: 3)
    --lr FLOAT                Learning rate — keep small to preserve
                              pre-trained knowledge (default: 1e-5)
    --batch-size INT          Training batch size (default: 32)
    --output TEXT              Checkpoint output directory
                              (default: models/timesfm_finetuned)
    --base-checkpoint TEXT    Base TimesFM HuggingFace repo or local path,
                              used only when no local checkpoint exists yet
                              (default: google/timesfm-2.5-200m-pytorch)
    --sync-target TEXT        rsync destination for checkpoint sync-back, e.g.
                              user@host:/path/to/models/timesfm_finetuned/
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

from crypto_ai.database.connection import async_session_factory  # noqa: E402
from crypto_ai.database.models.configuration import Configuration  # noqa: E402
from crypto_ai.database.models.customer import Customer  # noqa: E402
from crypto_ai.database.models.finetune_progress import FinetuneProgress  # noqa: E402
from crypto_ai.database.models.outlet import Outlet  # noqa: E402
from crypto_ai.database.models.outlet_group import OutletGroupMember  # noqa: E402
from crypto_ai.logging import configure_logging  # noqa: E402
from crypto_ai.services.sales import SalesService  # noqa: E402

configure_logging()
log = logging.getLogger(__name__)

ENGINE_NAME = "timesfm"
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
    """Load the prediction engine row by slug (e.g. 'timesfm')."""
    from crypto_ai.database.models.prediction_engine import PredictionEngine as PredictionEngineModel
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
    """Return outlet IDs already marked as fine-tuned for this engine.

    Returns a dict mapping outlet_id to its FinetuneProgress row so callers
    can inspect ``data_end_date`` for incremental training.
    """
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
    # Delete any existing row (handles --force re-runs cleanly)
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
    # Determine customers
    if customer_ids:
        stmt = select(Customer).where(
            Customer.id.in_(customer_ids), Customer.active.is_(True)
        )
    else:
        stmt = select(Customer).where(Customer.active.is_(True))
    result = await session.execute(stmt)
    customers = list(result.scalars().all())
    log.info("Found %d customer(s) to process", len(customers))

    # Resolve outlet group IDs to outlet IDs
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
# Training (single outlet)
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
        log.warning("No training windows for this outlet — skipping.")
        return

    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=0)

    nn_module.train()
    optimizer = AdamW(nn_module.parameters(), lr=lr)

    for epoch in range(1, epochs + 1):
        epoch_loss = 0.0
        n_batches = 0

        for ctx_batch, tgt_batch in loader:
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
            n_batches += 1

        avg_loss = epoch_loss / max(n_batches, 1)
        log.info("  Epoch %d/%d — avg MSE loss: %.6f", epoch, epochs, avg_loss)

    nn_module.eval()


# ---------------------------------------------------------------------------
# Checkpoint saving
# ---------------------------------------------------------------------------

def save_checkpoint(model: object, output_dir: str) -> None:
    """Save the fine-tuned model to output_dir in HuggingFace format.

    Writes to a temporary directory first, then atomically replaces
    output_dir with a rename. This means an interrupted save never
    corrupts the previous good checkpoint — the old directory is only
    replaced once the new one is fully written.
    """
    import shutil
    import tempfile

    parent = os.path.dirname(os.path.abspath(output_dir))
    os.makedirs(parent, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=parent, prefix=".tmp_checkpoint_") as tmp_dir:
        if hasattr(model, "save_pretrained"):
            model.save_pretrained(tmp_dir)
        else:
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
    # Ensure trailing slash on source so rsync copies contents, not the dir itself
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
        description="Fine-tune TimesFM 2.5 on sales data (per-outlet, resumable).",
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
    p.add_argument(
        "--sync-target",
        default=os.environ.get("SYNC_TARGET"),
        help="rsync destination for checkpoint sync-back, e.g. "
             "user@host:/path/to/models/timesfm_finetuned/ "
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
    # Priority: engine config (prediction_engine table) > global config > CLI/env > hardcoded
    async with async_session_factory() as session:
        db_config = await _load_db_config(session)
        engine_config = await _load_engine_config(session, ENGINE_NAME)

    # Start with CLI / env defaults
    effective_output = args.output
    effective_sync_every = args.sync_every

    # Global system config overrides hardcoded defaults
    if db_config:
        log.info("Loaded system configuration from database")
        if effective_output == "models/timesfm_finetuned" and db_config.finetuned_model_path:
            effective_output = db_config.finetuned_model_path
        if effective_sync_every == int(os.environ.get("SYNC_EVERY", "5")) and db_config.finetune_sync_every:
            effective_sync_every = db_config.finetune_sync_every

    # Engine-specific config takes precedence over global
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
        import timesfm
    except ImportError:
        log.error("timesfm package not found. Install it with: uv sync --extra dev")
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

    # Build work list: for completed outlets with a data_end_date, use the
    # day after that date as the per-outlet start_date so we only train on
    # new data.  Outlets with no new data will be skipped later (too short).
    pairs: list[tuple[str, str, date | None]] = []  # (customer_id, outlet_id, effective_start)
    for cid, oid in all_pairs:
        prev = completed.get(oid)
        if prev is not None and not args.force:
            if prev.data_end_date is not None:
                # Incremental: start from the day after the last trained date
                effective_start = prev.data_end_date + timedelta(days=1)
                if start_date and start_date > effective_start:
                    effective_start = start_date
                log.info(
                    "Outlet %s: incremental fine-tune from %s (previously trained up to %s)",
                    oid, effective_start, prev.data_end_date,
                )
                pairs.append((cid, oid, effective_start))
            else:
                # Completed but no date tracking — skip (legacy row)
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
    has_local = os.path.isdir(effective_output) and any(
        f.endswith((".safetensors", ".bin")) for f in os.listdir(effective_output)
    )
    if has_local:
        log.info(
            "Resuming from existing checkpoint: '%s' "
            "(delete this directory to start over from the base model)",
            effective_output,
        )
        checkpoint = effective_output
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
                model=model,
                series_list=[series],
                context_length=args.context_length,
                horizon=args.horizon,
                epochs=args.epochs,
                lr=args.lr,
                batch_size=args.batch_size,
            )

            save_checkpoint(model, effective_output)

            # Record the full date range: keep the original start if this is
            # incremental (the model has seen all data from the very first run).
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

            # Periodic sync back to production server
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
        # Final sync to ensure the last batch is copied back
        if args.sync_target:
            sync_checkpoint(effective_output, args.sync_target)
        log.info(
            "To use the fine-tuned model pass \"engine\": \"timesfm_finetuned\" in your requests."
        )


def main() -> None:
    args = parse_args()
    asyncio.run(_main_async(args))


if __name__ == "__main__":
    main()
