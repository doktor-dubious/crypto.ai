"""Async database connection and session management."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from gorm_ai.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=settings.database_echo,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that provides an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def task_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a DB session safe for use inside Celery tasks.

    Celery prefork workers call asyncio.run() which creates a new event loop
    per task. asyncpg connections from the shared pool are bound to the loop
    that created them, causing 'Future attached to a different loop' errors.
    NullPool disables pooling so every task_session() call gets a fresh
    connection on the current event loop.
    """
    task_engine = create_async_engine(
        get_settings().database_url,
        echo=get_settings().database_echo,
        poolclass=NullPool,
    )
    factory = async_sessionmaker(task_engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with factory() as session:
            yield session
    finally:
        await task_engine.dispose()
