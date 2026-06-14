"""Customer configuration service for business logic."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models import CustomerConfiguration
from crypto_ai.schemas.customer_configuration import (
    CustomerConfigurationCreate,
    CustomerConfigurationUpdate,
)


class CustomerConfigurationService:
    """Service for customer configuration operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(
        self, customer_id: str, data: CustomerConfigurationCreate
    ) -> CustomerConfiguration:
        """Create customer configuration."""
        config = CustomerConfiguration(customer_id=customer_id, **data.model_dump())
        self.session.add(config)
        await self.session.flush()
        await self.session.refresh(config)
        return config

    async def get(self, config_id: str) -> CustomerConfiguration | None:
        """Get customer configuration by ID."""
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.id == config_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_customer(self, customer_id: str) -> CustomerConfiguration | None:
        """Get customer configuration by customer ID."""
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def update(
        self, customer_id: str, data: CustomerConfigurationUpdate
    ) -> CustomerConfiguration | None:
        """Update customer configuration."""
        config = await self.get_by_customer(customer_id)
        if not config:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(config, field, value)

        await self.session.flush()
        await self.session.refresh(config)
        return config

    async def delete(self, customer_id: str, hard_delete: bool = False) -> bool:
        """Delete customer configuration (soft delete by default)."""
        config = await self.get_by_customer(customer_id)
        if not config:
            return False

        if hard_delete:
            await self.session.delete(config)
        else:
            config.active = False
            await self.session.flush()

        return True
