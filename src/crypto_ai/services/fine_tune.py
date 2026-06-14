"""Fine-tune tracking service."""

import logging
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from crypto_ai.database.models.fine_tune import FineTune
from crypto_ai.schemas.fine_tune import FineTuneResponse

logger = logging.getLogger(__name__)


class FineTuneTrackingService:
    """Manages fine-tune tracking records."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        customer_id: str,
        name: str,
        prediction_engine_id: str,
        task_id: str | None = None,
        outlet_group_id: str | None = None,
        finetune_from: date | None = None,
        finetune_to: date | None = None,
        description: str | None = None,
        worker_name: str | None = None,
    ) -> FineTune:
        row = FineTune(
            customer_id=customer_id,
            name=name,
            description=description,
            prediction_engine_id=prediction_engine_id,
            task_id=task_id,
            outlet_group_id=outlet_group_id,
            finetune_from=finetune_from,
            finetune_to=finetune_to,
            worker_name=worker_name,
            started_at=datetime.now(UTC),
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def update_counts(
        self,
        fine_tune_id: str,
        finetuned_outlets: int,
        pathological_outlets: int,
    ) -> None:
        row = await self.session.get(FineTune, fine_tune_id)
        if row:
            row.finetuned_outlets = finetuned_outlets
            row.pathological_outlets = pathological_outlets
            await self.session.flush()

    async def complete(
        self,
        fine_tune_id: str,
        end_condition: str,
    ) -> None:
        row = await self.session.get(FineTune, fine_tune_id)
        if row:
            row.ended_at = datetime.now(UTC)
            row.end_condition = end_condition
            await self.session.flush()

    async def list(
        self,
        limit: int = 500,
        offset: int = 0,
    ) -> tuple[list[FineTuneResponse], int]:
        count_result = await self.session.execute(
            select(func.count()).select_from(FineTune).where(
                FineTune.active.is_(True),
            )
        )
        total = count_result.scalar_one()

        result = await self.session.execute(
            select(FineTune)
            .where(FineTune.active.is_(True))
            .options(
                selectinload(FineTune.outlet_group),
                selectinload(FineTune.prediction_engine),
            )
            .order_by(FineTune.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = result.scalars().all()

        items = []
        for r in rows:
            items.append(FineTuneResponse(
                id=r.id,
                customer_id=r.customer_id,
                name=r.name,
                description=r.description,
                started_at=r.started_at,
                ended_at=r.ended_at,
                end_condition=r.end_condition,
                outlet_group_id=r.outlet_group_id,
                outlet_group_name=r.outlet_group.name if r.outlet_group else None,
                finetune_from=r.finetune_from,
                finetune_to=r.finetune_to,
                finetuned_outlets=r.finetuned_outlets,
                pathological_outlets=r.pathological_outlets,
                worker_name=r.worker_name,
                prediction_engine_id=r.prediction_engine_id,
                engine_name=r.prediction_engine.name if r.prediction_engine else None,
                task_id=r.task_id,
                active=r.active,
                created_at=r.created_at,
                updated_at=r.updated_at,
            ))
        return items, total

    async def delete(self, fine_tune_id: str) -> bool:
        row = await self.session.get(FineTune, fine_tune_id)
        if not row or not row.active:
            return False
        # Don't delete running tasks
        if row.end_condition is None and row.started_at is not None:
            return False
        row.active = False
        await self.session.flush()
        return True
