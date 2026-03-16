"""Customer service for business logic."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models import Customer
from gorm_ai.schemas.customer import CustomerCreate, CustomerUpdate


class CustomerService:
    """Service for customer operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: CustomerCreate) -> Customer:
        """Create a new customer."""
        customer = Customer(**data.model_dump())
        self.session.add(customer)
        await self.session.flush()
        await self.session.refresh(customer)
        return customer

    async def get(self, customer_id: str) -> Customer | None:
        """Get a customer by ID."""
        result = await self.session.execute(
            select(Customer).where(Customer.id == customer_id, Customer.active.is_(True))
        )
        return result.scalar_one_or_none()

    async def get_all(
        self,
        limit: int = 100,
        offset: int = 0,
        include_inactive: bool = False,
    ) -> list[Customer]:
        """Get all customers with pagination."""
        query = select(Customer)
        if not include_inactive:
            query = query.where(Customer.active.is_(True))
        query = query.order_by(Customer.name).limit(limit).offset(offset)
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def update(self, customer_id: str, data: CustomerUpdate) -> Customer | None:
        """Update a customer."""
        customer = await self.get(customer_id)
        if not customer:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(customer, field, value)

        await self.session.flush()
        await self.session.refresh(customer)
        return customer

    async def touch_last_opened(self, customer_id: str) -> Customer | None:
        """Update last_opened_at timestamp for a customer."""
        customer = await self.get(customer_id)
        if not customer:
            return None
        customer.last_opened_at = datetime.now(UTC)
        await self.session.flush()
        await self.session.refresh(customer)
        return customer

    async def delete(self, customer_id: str, hard_delete: bool = False) -> bool:
        """Delete a customer (soft delete by default)."""
        customer = await self.get(customer_id)
        if not customer:
            return False

        if hard_delete:
            await self.session.delete(customer)
        else:
            customer.active = False
            await self.session.flush()

        return True
