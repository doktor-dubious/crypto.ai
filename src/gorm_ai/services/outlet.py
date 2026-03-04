"""Outlet service for business logic."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from gorm_ai.database.models import Outlet, OutletDelivery, OutletInfo
from gorm_ai.schemas.outlet import (
    OutletCreate,
    OutletDeliveryCreate,
    OutletInfoCreate,
    OutletUpdate,
)


class OutletService:
    """Service for outlet operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: OutletCreate) -> Outlet:
        """Create a new outlet."""
        outlet_data = data.model_dump(exclude={"info", "deliveries"})
        outlet = Outlet(**outlet_data)
        self.session.add(outlet)
        await self.session.flush()

        # Add info records
        if data.info:
            for info_data in data.info:
                info = OutletInfo(outlet_id=outlet.id, **info_data.model_dump())
                self.session.add(info)

        # Add delivery records
        if data.deliveries:
            for delivery_data in data.deliveries:
                delivery = OutletDelivery(outlet_id=outlet.id, **delivery_data.model_dump())
                self.session.add(delivery)

        await self.session.flush()
        await self.session.refresh(outlet)
        return outlet

    async def get(self, outlet_id: str) -> Outlet | None:
        """Get an outlet by ID."""
        result = await self.session.execute(
            select(Outlet)
            .where(Outlet.id == outlet_id, Outlet.active.is_(True))
            .options(selectinload(Outlet.info), selectinload(Outlet.deliveries))
        )
        return result.scalar_one_or_none()

    async def get_by_ext_id(self, ext_id: str, customer_id: str | None = None) -> Outlet | None:
        """Get an outlet by external ID."""
        query = select(Outlet).where(Outlet.ext_id == ext_id, Outlet.active.is_(True))
        if customer_id:
            query = query.where(Outlet.customer_id == customer_id)
        query = query.options(selectinload(Outlet.info), selectinload(Outlet.deliveries))
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_all(
        self,
        customer_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
        include_inactive: bool = False,
    ) -> list[Outlet]:
        """Get all outlets with optional customer filter."""
        query = select(Outlet)
        if not include_inactive:
            query = query.where(Outlet.active.is_(True))
        if customer_id:
            query = query.where(Outlet.customer_id == customer_id)
        query = (
            query.options(selectinload(Outlet.info), selectinload(Outlet.deliveries))
            .order_by(Outlet.name)
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def update(self, outlet_id: str, data: OutletUpdate) -> Outlet | None:
        """Update an outlet."""
        outlet = await self.get(outlet_id)
        if not outlet:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(outlet, field, value)

        await self.session.flush()
        await self.session.refresh(outlet)
        return outlet

    async def delete(self, outlet_id: str, hard_delete: bool = False) -> bool:
        """Delete an outlet (soft delete by default)."""
        outlet = await self.get(outlet_id)
        if not outlet:
            return False

        if hard_delete:
            await self.session.delete(outlet)
        else:
            outlet.active = False
            await self.session.flush()

        return True

    async def add_info(self, outlet_id: str, data: OutletInfoCreate) -> OutletInfo | None:
        """Add info record to outlet."""
        outlet = await self.get(outlet_id)
        if not outlet:
            return None

        info = OutletInfo(outlet_id=outlet_id, **data.model_dump())
        self.session.add(info)
        await self.session.flush()
        await self.session.refresh(info)
        return info

    async def add_delivery(
        self, outlet_id: str, data: OutletDeliveryCreate
    ) -> OutletDelivery | None:
        """Add delivery record to outlet."""
        outlet = await self.get(outlet_id)
        if not outlet:
            return None

        delivery = OutletDelivery(outlet_id=outlet_id, **data.model_dump())
        self.session.add(delivery)
        await self.session.flush()
        await self.session.refresh(delivery)
        return delivery

    async def get_deliveries(self, outlet_id: str) -> list[OutletDelivery]:
        """Get all deliveries for an outlet."""
        result = await self.session.execute(
            select(OutletDelivery).where(
                OutletDelivery.outlet_id == outlet_id,
                OutletDelivery.active.is_(True),
            )
        )
        return list(result.scalars().all())
