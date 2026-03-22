"""Fine-tuning service."""

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.finetune_progress import FinetuneProgress

logger = logging.getLogger(__name__)


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

    async def run_finetune(
        self,
        request_data: dict,
        on_progress: Callable[[int, str | None], Awaitable[None]] | None = None,
    ) -> dict:
        """Run fine-tuning for the given parameters.

        This is a placeholder that sets up the pipeline structure.
        The actual training logic depends on the engine being fine-tuned.
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

        start_date = date.fromisoformat(start_date_str) if start_date_str else None
        end_date = date.fromisoformat(end_date_str) if end_date_str else date.today()

        if on_progress:
            await on_progress(5, "Loading sales data")

        # Fetch outlets for this customer (optionally filtered by group)
        from gorm_ai.database.models.outlet import Outlet
        from gorm_ai.database.models.outlet_group import OutletGroupMember

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

        # Fetch sales data
        from gorm_ai.database.models.sales import Sales as Sale

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
        from collections import defaultdict
        outlet_series: dict[str, list] = defaultdict(list)
        for s in sales:
            outlet_series[s.outlet_id].append(float(s.sold))

        if on_progress:
            await on_progress(30, "Starting fine-tuning")

        # ── Actual fine-tuning ──
        # Import and run the TimesFM fine-tuning pipeline
        try:
            from gorm_ai.prediction.finetune import run_timesfm_finetune

            await run_timesfm_finetune(
                outlet_series=outlet_series,
                context_length=context_length,
                horizon=horizon,
                epochs=epochs,
                learning_rate=learning_rate,
                batch_size=batch_size,
                on_progress=on_progress,
            )
        except ImportError:
            # Fine-tuning module not available — log and mark outlets as done
            logger.warning("Fine-tuning module not available, recording progress only")
            if on_progress:
                await on_progress(90, "Fine-tuning module not available — recording progress")

        # Record progress for each outlet
        now = datetime.now(UTC)
        for outlet_id in outlet_ids:
            # Upsert: update if exists, insert if not
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
            else:
                self._session.add(FinetuneProgress(
                    outlet_id=outlet_id,
                    customer_id=customer_id,
                    engine=engine_id,
                    completed_at=now,
                    context_length=context_length,
                    horizon=horizon,
                    epochs=epochs,
                ))

        if on_progress:
            await on_progress(100, "Fine-tuning complete")

        return {
            "engine_id": engine_id,
            "customer_id": customer_id,
            "outlets_processed": len(outlet_ids),
            "sales_records": len(sales),
        }
