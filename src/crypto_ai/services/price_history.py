"""Price history service for business logic."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.price_history import PriceHistory
from crypto_ai.schemas.price_history import PriceHistoryCreate, PriceHistoryUpdate


class PriceHistoryService:
    """Service for price history operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: PriceHistoryCreate) -> list[PriceHistory]:
        """Create price history entries — one row per weekday in the request."""
        entries: list[PriceHistory] = []
        for wd in data.weekdays:
            entry = PriceHistory(
                customer_id=data.customer_id,
                name=data.name,
                description=data.description,
                effective_date=data.effective_date,
                weekday=wd,
                price_per_unit=data.price_per_unit,
                cost_per_unit=data.cost_per_unit,
                profit_per_unit=data.profit_per_unit,
            )
            self.session.add(entry)
            entries.append(entry)
        await self.session.flush()
        for entry in entries:
            await self.session.refresh(entry)
        return entries

    async def list_by_customer(self, customer_id: str) -> list[PriceHistory]:
        """List all price history entries for a customer, newest first."""
        result = await self.session.execute(
            select(PriceHistory)
            .where(
                PriceHistory.customer_id == customer_id,
                PriceHistory.active.is_(True),
            )
            .order_by(PriceHistory.effective_date.desc())
        )
        return list(result.scalars().all())

    async def get(self, entry_id: str) -> PriceHistory | None:
        """Get a price history entry by ID."""
        result = await self.session.execute(
            select(PriceHistory).where(
                PriceHistory.id == entry_id,
                PriceHistory.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def update(
        self, entry_id: str, data: PriceHistoryUpdate
    ) -> PriceHistory | None:
        """Update a price history entry."""
        entry = await self.get(entry_id)
        if not entry:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(entry, field, value)

        await self.session.flush()
        await self.session.refresh(entry)
        return entry

    async def delete(self, entry_id: str) -> bool:
        """Soft delete a price history entry."""
        entry = await self.get(entry_id)
        if not entry:
            return False

        entry.active = False
        await self.session.flush()
        return True
