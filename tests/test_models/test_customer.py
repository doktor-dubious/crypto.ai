"""Tests for Customer model."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models import Customer


@pytest.mark.asyncio
async def test_create_customer(session: AsyncSession):
    """Test creating a customer."""
    customer = Customer(
        name="Test Customer",
        type=1,
        description="A test customer",
    )
    session.add(customer)
    await session.flush()
    await session.refresh(customer)

    assert customer.id is not None
    assert customer.name == "Test Customer"
    assert customer.type == 1
    assert customer.active is True
    assert customer.created_at is not None
    assert customer.updated_at is not None
