"""Pytest configuration and fixtures."""

from collections.abc import AsyncGenerator
from datetime import date
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from gorm_ai.database.base import Base
from gorm_ai.main import app

# Use SQLite for testing
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop_policy():
    """Set event loop policy."""
    import asyncio

    return asyncio.DefaultEventLoopPolicy()


@pytest_asyncio.fixture
async def engine():
    """Create test database engine."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture
async def session(engine) -> AsyncGenerator[AsyncSession, None]:
    """Create test database session."""
    async_session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Create test HTTP client."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


@pytest.fixture
def sample_customer_data() -> dict:
    """Sample customer data for testing."""
    return {
        "name": "Test Customer",
        "type": 1,
        "description": "A test customer",
        "notes": "Test notes",
    }


@pytest.fixture
def sample_outlet_data() -> dict:
    """Sample outlet data for testing."""
    return {
        "customer_id": str(uuid4()),
        "ext_id": "EXT001",
        "name": "Test Outlet",
        "description": "A test outlet",
        "city": "Test City",
        "country": "US",
    }


@pytest.fixture
def sample_sales_data() -> dict:
    """Sample sales data for testing."""
    return {
        "customer_id": str(uuid4()),
        "outlet_id": str(uuid4()),
        "date": date.today().isoformat(),
        "sold": 100,
    }


@pytest.fixture
def sample_prediction_request() -> dict:
    """Sample prediction request for testing."""
    return {
        "customer_id": str(uuid4()),
        "start_date": "2024-01-01",
        "end_date": "2024-01-31",
        "horizon": 7,
        "engine": "statistical",
    }
