"""User-Customer service for querying customer access by user."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.customer import Customer
from crypto_ai.database.models.user_customer import UserCustomer


class UserCustomerService:
    """Service for user-customer permission operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_customers_for_user(self, user_id: str) -> list[Customer]:
        """Get all active customers a user has access to."""
        query = (
            select(Customer)
            .join(UserCustomer, UserCustomer.customer_id == Customer.id)
            .where(
                UserCustomer.user_id == user_id,
                UserCustomer.active.is_(True),
                Customer.active.is_(True),
            )
            .order_by(Customer.name)
        )
        result = await self.session.execute(query)
        return list(result.scalars().all())
