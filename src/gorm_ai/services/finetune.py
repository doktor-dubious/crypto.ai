"""Fine-tuning service."""

import asyncio
import logging
import os
from collections import defaultdict
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.finetune_progress import FinetuneProgress
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_group import OutletGroupMember
from gorm_ai.database.models.prediction_engine import (
    PredictionEngine as PredictionEngineModel,
)
from gorm_ai.database.models.sales import Sales as Sale

logger = logging.getLogger(__name__)

# Map engine slugs (or slug prefixes) to the training function that knows
# how to fine-tune that engine family.  Each function receives:
#   (outlet_series, context_length, horizon, epochs, learning_rate,
#    batch_size, output_dir, on_progress)
# and is expected to be async.
_ENGINE_FINETUNE_REGISTRY: dict[str, str] = {
    # slug → dotted import path of the async fine-tune runner
    "timesfm": "gorm_ai.services._finetune_timesfm.run_finetune",
    "moirai2": "gorm_ai.services._finetune_moirai2.run_finetune",
}


def _resolve_finetune_runner(slug: str):
    """Return the async fine-tune function for the given engine slug.

    Tries exact match first, then prefix match (e.g. "timesfm_finetuned"
    matches "timesfm").  Returns None if no runner is registered.
    """
    # Exact match
    path = _ENGINE_FINETUNE_REGISTRY.get(slug)
    if path is None:
        # Prefix match: "timesfm_finetuned" → "timesfm"
        for key, val in _ENGINE_FINETUNE_REGISTRY.items():
            if slug.startswith(key):
                path = val
                break

    if path is None:
        return None

    module_path, func_name = path.rsplit(".", 1)
    import importlib
    mod = importlib.import_module(module_path)
    return getattr(mod, func_name)


class FinetuneService:
    """Orchestrates model fine-tuning on customer sales data."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def count_finetuned(self, engine_id: str) -> int:
        """Count distinct customers that have been fine-tuned for an engine."""
        result = await self._session.execute(
            select(func.count(func.distinct(FinetuneProgress.customer_id))).where(
                FinetuneProgress.engine == engine_id,
                FinetuneProgress.active.is_(True),
            )
        )
        return result.scalar_one()

    async def _resolve_engine(self, engine_id: str) -> PredictionEngineModel:
        """Look up the prediction engine row by UUID."""
        result = await self._session.execute(
            select(PredictionEngineModel).where(
                PredictionEngineModel.id == engine_id,
                PredictionEngineModel.active.is_(True),
            )
        )
        engine = result.scalar_one_or_none()
        if not engine:
            raise ValueError(f"Prediction engine {engine_id} not found")
        return engine

    async def run_finetune(
        self,
        request_data: dict,
        on_progress: Callable[[int, str | None], Awaitable[None]] | None = None,
    ) -> dict:
        """Run fine-tuning for the given parameters.

        Dispatches to the correct engine-specific training function based
        on the engine's slug.
        """
        engine_id = request_data["prediction_engine_id"]
        customer_id = request_data["customer_id"]
        outlet_group_id = request_data.get("outlet_group_id")
        start_date_str = request_data.get("start_date")
        end_date_str = request_data.get("end_date")
        context_length = request_data.get("context_length", 512)
        horizon = request_data.get("horizon", 64)
        epochs = request_data.get("epochs", 50)
        learning_rate = request_data.get("learning_rate", 0.001)
        batch_size = request_data.get("batch_size", 32)
        early_stopping_patience = request_data.get("early_stopping_patience", 0)

        start_date = date.fromisoformat(start_date_str) if start_date_str else None
        end_date = date.fromisoformat(end_date_str) if end_date_str else date.today()

        # ── Resolve engine and find the right training function ──────────
        engine = await self._resolve_engine(engine_id)
        slug = engine.slug
        output_dir = engine.finetuned_model_path or f"models/finetune/{slug}"

        runner = _resolve_finetune_runner(slug)
        if runner is None:
            supported = ", ".join(sorted(_ENGINE_FINETUNE_REGISTRY.keys()))
            raise ValueError(
                f"Fine-tuning is not supported for engine '{slug}'. "
                f"Supported engines: {supported}"
            )

        logger.info("Fine-tuning engine '%s' (slug=%s), output=%s", engine.name, slug, output_dir)

        if on_progress:
            await on_progress(5, f"Loading sales data for {engine.name}")

        # ── Fetch outlets ────────────────────────────────────────────────
        query = select(Outlet.id).where(
            Outlet.customer_id == customer_id,
            Outlet.active.is_(True),
        )
        if outlet_group_id:
            query = query.join(
                OutletGroupMember,
                OutletGroupMember.outlet_id == Outlet.id,
            ).where(OutletGroupMember.group_id == outlet_group_id)

        result = await self._session.execute(query)
        outlet_ids = [row[0] for row in result.all()]

        if not outlet_ids:
            raise ValueError("No active outlets found for this customer/group")

        if on_progress:
            await on_progress(10, f"Found {len(outlet_ids)} outlets")

        # ── Fetch sales data ─────────────────────────────────────────────
        sales_query = select(Sale).where(
            Sale.customer_id == customer_id,
            Sale.outlet_id.in_(outlet_ids),
            Sale.active.is_(True),
        )
        if start_date:
            sales_query = sales_query.where(Sale.date >= start_date)
        if end_date:
            sales_query = sales_query.where(Sale.date <= end_date)

        sales_query = sales_query.order_by(Sale.outlet_id, Sale.date)
        result = await self._session.execute(sales_query)
        sales = result.scalars().all()

        if not sales:
            raise ValueError("No sales data found for the given parameters")

        if on_progress:
            await on_progress(20, f"Loaded {len(sales)} sales records")

        # Group by outlet
        outlet_series: dict[str, list[float]] = defaultdict(list)
        for s in sales:
            outlet_series[s.outlet_id].append(float(s.sold))

        if on_progress:
            await on_progress(30, f"Starting fine-tuning ({slug})")

        # ── Resolve sync parameters ───────────────────────────────────────
        # Sync only happens on remote workers (RunPod) where SYNC_TARGET is
        # set in the environment.  The per-engine DB field overrides *where*
        # to sync, but without the env var no sync occurs at all — on the
        # local server the checkpoint is written directly to the model path.
        env_sync = os.environ.get("SYNC_TARGET")
        sync_target = (engine.finetune_sync_target or env_sync) if env_sync else None
        sync_every = engine.finetune_sync_every or int(os.environ.get("SYNC_EVERY", "5"))

        # ── Dispatch to engine-specific training ─────────────────────────
        await runner(
            outlet_series=outlet_series,
            context_length=context_length,
            horizon=horizon,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            output_dir=output_dir,
            on_progress=on_progress,
            sync_target=sync_target,
            sync_every=sync_every,
            early_stopping_patience=early_stopping_patience,
        )

        # ── Record progress for each outlet ──────────────────────────────
        now = datetime.now(UTC)
        for outlet_id in outlet_ids:
            existing = await self._session.execute(
                select(FinetuneProgress).where(
                    FinetuneProgress.outlet_id == outlet_id,
                    FinetuneProgress.engine == engine_id,
                )
            )
            row = existing.scalar_one_or_none()
            if row:
                row.completed_at = now
                row.context_length = context_length
                row.horizon = horizon
                row.epochs = epochs
                row.data_end_date = end_date
            else:
                self._session.add(FinetuneProgress(
                    outlet_id=outlet_id,
                    customer_id=customer_id,
                    engine=engine_id,
                    completed_at=now,
                    context_length=context_length,
                    horizon=horizon,
                    epochs=epochs,
                    data_start_date=start_date,
                    data_end_date=end_date,
                ))

        if on_progress:
            await on_progress(100, "Fine-tuning complete")

        return {
            "engine_id": engine_id,
            "engine_slug": slug,
            "customer_id": customer_id,
            "outlets_processed": len(outlet_ids),
            "sales_records": len(sales),
        }
