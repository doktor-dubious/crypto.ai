"""Pad service for managing special-date prediction adjustment rules."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.pad import Pad, PadDate
from gorm_ai.schemas.pad import PadCreate, PadDateAdd, PadUpdate


class PadService:
    """Service for pad and pad date operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: PadCreate) -> Pad:
        """Create a new pad, optionally with an initial set of dates."""
        pad = Pad(
            customer_id=data.customer_id,
            name=data.name,
            historic_days=data.historic_days,
            allow_negative=data.allow_negative,
            boost=data.boost,
            boost_pct=data.boost_pct,
        )
        self.session.add(pad)
        await self.session.flush()

        for d in data.dates:
            self.session.add(PadDate(pad_id=pad.id, date=d))

        await self.session.flush()
        await self.session.refresh(pad)
        return pad

    async def get(self, pad_id: str) -> Pad | None:
        """Get a pad by ID (active only)."""
        result = await self.session.execute(
            select(Pad).where(Pad.id == pad_id, Pad.active.is_(True))
        )
        return result.scalar_one_or_none()

    async def list_by_customer(self, customer_id: str) -> list[Pad]:
        """List all active pads for a customer."""
        result = await self.session.execute(
            select(Pad)
            .where(Pad.customer_id == customer_id, Pad.active.is_(True))
            .order_by(Pad.name)
        )
        return list(result.scalars().all())

    async def update(self, pad_id: str, data: PadUpdate) -> Pad | None:
        """Update pad fields."""
        pad = await self.get(pad_id)
        if not pad:
            return None

        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(pad, field, value)

        await self.session.flush()
        await self.session.refresh(pad)
        return pad

    async def delete(self, pad_id: str) -> bool:
        """Soft-delete a pad."""
        pad = await self.get(pad_id)
        if not pad:
            return False
        pad.active = False
        await self.session.flush()
        return True

    async def add_dates(self, pad_id: str, data: PadDateAdd) -> Pad | None:
        """Add dates to a pad (skips duplicates)."""
        pad = await self.get(pad_id)
        if not pad:
            return None

        existing = {pd.date for pd in pad.dates}
        for d in data.dates:
            if d not in existing:
                self.session.add(PadDate(pad_id=pad_id, date=d))

        await self.session.flush()
        await self.session.refresh(pad)
        return pad

    async def remove_date(self, pad_id: str, target_date: date) -> bool:
        """Soft-delete a specific date from a pad."""
        result = await self.session.execute(
            select(PadDate).where(
                PadDate.pad_id == pad_id,
                PadDate.date == target_date,
                PadDate.active.is_(True),
            )
        )
        pad_date = result.scalar_one_or_none()
        if not pad_date:
            return False
        pad_date.active = False
        await self.session.flush()
        return True
