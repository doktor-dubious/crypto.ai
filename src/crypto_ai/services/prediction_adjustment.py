"""Prediction adjustment service for business logic."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from crypto_ai.database.models import PredictionAdjustment
from crypto_ai.database.models.outlet_group import OutletGroup
from crypto_ai.schemas.prediction_adjustment import (
    PredictionAdjustmentCreate,
    PredictionAdjustmentUpdate,
)


class PredictionAdjustmentService:
    """Service for prediction adjustment operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: PredictionAdjustmentCreate) -> PredictionAdjustment:
        """Create a new prediction adjustment."""
        adjustment = PredictionAdjustment(**data.model_dump())
        self.session.add(adjustment)
        await self.session.flush()
        await self.session.refresh(adjustment)
        return adjustment

    async def get(self, adjustment_id: str) -> PredictionAdjustment | None:
        """Get a prediction adjustment by ID."""
        result = await self.session.execute(
            select(PredictionAdjustment).where(
                PredictionAdjustment.id == adjustment_id,
                PredictionAdjustment.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_customer(self, customer_id: str) -> list[PredictionAdjustment]:
        """Get all prediction adjustments for a customer (via outlet groups)."""
        result = await self.session.execute(
            select(PredictionAdjustment)
            .join(OutletGroup, PredictionAdjustment.group_id == OutletGroup.id)
            .where(
                OutletGroup.customer_id == customer_id,
                OutletGroup.active.is_(True),
                PredictionAdjustment.active.is_(True),
            )
            .options(joinedload(PredictionAdjustment.group))
            .order_by(PredictionAdjustment.date.desc())
        )
        return list(result.scalars().unique().all())

    async def get_by_group(self, group_id: str) -> list[PredictionAdjustment]:
        """Get all prediction adjustments for a group."""
        result = await self.session.execute(
            select(PredictionAdjustment)
            .where(
                PredictionAdjustment.group_id == group_id,
                PredictionAdjustment.active.is_(True),
            )
            .order_by(PredictionAdjustment.date)
        )
        return list(result.scalars().all())

    async def update(
        self, adjustment_id: str, data: PredictionAdjustmentUpdate
    ) -> PredictionAdjustment | None:
        """Update a prediction adjustment."""
        adjustment = await self.get(adjustment_id)
        if not adjustment:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(adjustment, field, value)

        await self.session.flush()
        await self.session.refresh(adjustment)
        return adjustment

    async def delete(self, adjustment_id: str, hard_delete: bool = False) -> bool:
        """Delete a prediction adjustment (soft delete by default)."""
        adjustment = await self.get(adjustment_id)
        if not adjustment:
            return False

        if hard_delete:
            await self.session.delete(adjustment)
        else:
            adjustment.active = False
            await self.session.flush()

        return True
