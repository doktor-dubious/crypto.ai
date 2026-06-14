"""Alembic environment configuration."""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from crypto_ai.config import get_settings
from crypto_ai.database.base import Base

# Import all models to register them with Base.metadata
from crypto_ai.database.models import (  # noqa: F401
    Customer,
    Outlet,
    OutletDelivery,
    OutletGroup,
    OutletGroupMember,
    OutletInfo,
    PredictionEngine,
    PriceHistory,
    Sales,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)


def _include_name(name, type_, parent_names):
    """Exclude ba_* tables (managed by Prisma for Better Auth)."""
    if type_ == "table" and name and name.startswith("ba_"):
        return False
    return True


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_name=_include_name,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    """Run migrations with given connection."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_name=_include_name,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode with async engine."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
