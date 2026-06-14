"""SimulationFilter service."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.simulation_filter import SimulationFilter
from crypto_ai.schemas.simulation_filter import SimulationFilterCreate, SimulationFilterUpdate


class SimulationFilterService:
    """Service for simulation filter operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_by_customer(self, customer_id: str) -> list[SimulationFilter]:
        """List all active simulation filters for a customer."""
        result = await self.session.execute(
            select(SimulationFilter)
            .where(SimulationFilter.customer_id == customer_id, SimulationFilter.active.is_(True))
            .order_by(SimulationFilter.from_date)
        )
        return list(result.scalars().all())

    async def get(self, filter_id: str) -> SimulationFilter | None:
        """Get a simulation filter by ID."""
        result = await self.session.execute(
            select(SimulationFilter).where(
                SimulationFilter.id == filter_id, SimulationFilter.active.is_(True)
            )
        )
        return result.scalar_one_or_none()

    async def create(self, data: SimulationFilterCreate) -> SimulationFilter:
        """Create a new simulation filter."""
        sf = SimulationFilter(**data.model_dump())
        self.session.add(sf)
        await self.session.flush()
        await self.session.refresh(sf)
        return sf

    async def update(self, filter_id: str, data: SimulationFilterUpdate) -> SimulationFilter | None:
        """Update a simulation filter."""
        sf = await self.get(filter_id)
        if not sf:
            return None
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(sf, field, value)
        await self.session.flush()
        await self.session.refresh(sf)
        return sf

    async def delete(self, filter_id: str) -> bool:
        """Soft-delete a simulation filter."""
        sf = await self.get(filter_id)
        if not sf:
            return False
        sf.active = False
        await self.session.flush()
        return True
