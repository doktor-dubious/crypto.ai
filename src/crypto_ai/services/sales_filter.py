"""SalesFilter service."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.sales_filter import SalesFilter
from crypto_ai.schemas.sales_filter import SalesFilterCreate, SalesFilterUpdate


class SalesFilterService:
    """Service for sales filter operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_by_customer(self, customer_id: str) -> list[SalesFilter]:
        """List all active sales filters for a customer."""
        result = await self.session.execute(
            select(SalesFilter)
            .where(SalesFilter.customer_id == customer_id, SalesFilter.active.is_(True))
            .order_by(SalesFilter.from_date)
        )
        return list(result.scalars().all())

    async def get(self, filter_id: str) -> SalesFilter | None:
        """Get a sales filter by ID."""
        result = await self.session.execute(
            select(SalesFilter).where(
                SalesFilter.id == filter_id, SalesFilter.active.is_(True)
            )
        )
        return result.scalar_one_or_none()

    async def create(self, data: SalesFilterCreate) -> SalesFilter:
        """Create a new sales filter."""
        sf = SalesFilter(**data.model_dump())
        self.session.add(sf)
        await self.session.flush()
        await self.session.refresh(sf)
        return sf

    async def update(self, filter_id: str, data: SalesFilterUpdate) -> SalesFilter | None:
        """Update a sales filter."""
        sf = await self.get(filter_id)
        if not sf:
            return None
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(sf, field, value)
        await self.session.flush()
        await self.session.refresh(sf)
        return sf

    async def delete(self, filter_id: str) -> bool:
        """Soft-delete a sales filter."""
        sf = await self.get(filter_id)
        if not sf:
            return False
        sf.active = False
        await self.session.flush()
        return True
