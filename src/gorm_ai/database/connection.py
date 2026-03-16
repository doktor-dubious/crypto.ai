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


# Lazily-created engine for Celery tasks.  Each asyncio.run() call (= each
# Celery task) gets its own event loop, so connections from a previous task's
# loop can't be reused.  NullPool avoids stale-connection errors across tasks
# while pool_pre_ping=True lets SQLAlchemy transparently reconnect if the
# connection drops during a long-running inference step within a single task.
_task_engine = None
_task_factory = None


def _get_task_factory() -> async_sessionmaker:
    """Return (and lazily create) the task-scoped session factory."""
    global _task_engine, _task_factory
    if _task_engine is None:
        _task_engine = create_async_engine(
            get_settings().database_url,
            echo=get_settings().database_echo,
            poolclass=NullPool,
            pool_pre_ping=True,
        )
        _task_factory = async_sessionmaker(
            _task_engine, class_=AsyncSession, expire_on_commit=False
        )
    return _task_factory


@asynccontextmanager
async def task_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a DB session safe for use inside Celery tasks.

    Uses NullPool with pool_pre_ping so each session gets a fresh connection
    that is validated before use.  The engine is shared across task_session()
    calls within the same asyncio.run() to avoid repeated engine creation.
    """
    factory = _get_task_factory()
    async with factory() as session:
        yield session
