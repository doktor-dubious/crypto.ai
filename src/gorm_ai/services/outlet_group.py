"""Outlet group service for business logic."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models import OutletGroup, OutletGroupMember
from gorm_ai.schemas.outlet_group import OutletGroupCreate, OutletGroupUpdate


class OutletGroupService:
    """Service for outlet group operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: OutletGroupCreate) -> OutletGroup:
        """Create a new outlet group."""
        group = OutletGroup(**data.model_dump())
        self.session.add(group)
        await self.session.flush()
        await self.session.refresh(group)
        return group

    async def get(self, group_id: str) -> OutletGroup | None:
        """Get an outlet group by ID."""
        result = await self.session.execute(
            select(OutletGroup).where(
                OutletGroup.id == group_id,
                OutletGroup.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_all(
        self,
        customer_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[OutletGroup]:
        """Get all outlet groups with optional customer filter."""
        query = select(OutletGroup).where(OutletGroup.active.is_(True))
        if customer_id:
            query = query.where(OutletGroup.customer_id == customer_id)
        query = query.order_by(OutletGroup.name).limit(limit).offset(offset)
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def update(self, group_id: str, data: OutletGroupUpdate) -> OutletGroup | None:
        """Update an outlet group."""
        group = await self.get(group_id)
        if not group:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(group, field, value)

        await self.session.flush()
        await self.session.refresh(group)
        return group

    async def delete(self, group_id: str, hard_delete: bool = False) -> bool:
        """Delete an outlet group (soft delete by default)."""
        group = await self.get(group_id)
        if not group:
            return False

        if hard_delete:
            await self.session.delete(group)
        else:
            group.active = False
            await self.session.flush()

        return True

    async def add_outlet(self, group_id: str, outlet_id: str) -> OutletGroupMember:
        """Add an outlet to a group."""
        member = OutletGroupMember(group_id=group_id, outlet_id=outlet_id)
        self.session.add(member)
        await self.session.flush()
        await self.session.refresh(member)
        return member

    async def remove_outlet(self, group_id: str, outlet_id: str) -> bool:
        """Remove an outlet from a group."""
        result = await self.session.execute(
            select(OutletGroupMember).where(
                OutletGroupMember.group_id == group_id,
                OutletGroupMember.outlet_id == outlet_id,
                OutletGroupMember.active.is_(True),
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            return False

        member.active = False
        await self.session.flush()
        return True
