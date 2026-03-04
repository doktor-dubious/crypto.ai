"""Draw adjustment service for business logic."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models import DrawAdjustment
from gorm_ai.schemas.draw_adjustment import DrawAdjustmentCreate, DrawAdjustmentUpdate


class DrawAdjustmentService:
    """Service for draw adjustment operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: DrawAdjustmentCreate) -> DrawAdjustment:
        """Create a new draw adjustment."""
        adjustment = DrawAdjustment(**data.model_dump())
        self.session.add(adjustment)
        await self.session.flush()
        await self.session.refresh(adjustment)
        return adjustment

    async def get(self, adjustment_id: str) -> DrawAdjustment | None:
        """Get a draw adjustment by ID."""
        result = await self.session.execute(
            select(DrawAdjustment).where(
                DrawAdjustment.id == adjustment_id,
                DrawAdjustment.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_group(self, group_id: str) -> list[DrawAdjustment]:
        """Get all draw adjustments for a group."""
        result = await self.session.execute(
            select(DrawAdjustment)
            .where(
                DrawAdjustment.group_id == group_id,
                DrawAdjustment.active.is_(True),
            )
            .order_by(DrawAdjustment.start_date)
        )
        return list(result.scalars().all())

    async def update(
        self, adjustment_id: str, data: DrawAdjustmentUpdate
    ) -> DrawAdjustment | None:
        """Update a draw adjustment."""
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
        """Delete a draw adjustment (soft delete by default)."""
        adjustment = await self.get(adjustment_id)
        if not adjustment:
            return False

        if hard_delete:
            await self.session.delete(adjustment)
        else:
            adjustment.active = False
            await self.session.flush()

        return True
