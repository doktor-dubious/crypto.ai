"""ConfigurationCovariate service — resolve active covariate types per customer."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.configuration_covariate import ConfigurationCovariate


# Covariate type constants
TYPE_WEEKDAY = 1
TYPE_SELLING_PRICE = 2
TYPE_PAD = 3
ALL_TYPES = {TYPE_WEEKDAY, TYPE_SELLING_PRICE, TYPE_PAD}


class ConfigurationCovariateService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_global(self) -> list[ConfigurationCovariate]:
        """Return global default covariates (customer_id IS NULL)."""
        result = await self.session.execute(
            select(ConfigurationCovariate)
            .where(ConfigurationCovariate.customer_id.is_(None))
            .order_by(ConfigurationCovariate.type)
        )
        return list(result.scalars().all())

    async def list_for_customer(self, customer_id: str) -> list[ConfigurationCovariate]:
        """Return resolved covariates for a customer (customer-specific → global fallback).

        For each covariate type, returns the customer-specific row if it exists,
        otherwise the global default.
        """
        # Fetch customer-specific rows
        result = await self.session.execute(
            select(ConfigurationCovariate)
            .where(ConfigurationCovariate.customer_id == customer_id)
            .order_by(ConfigurationCovariate.type)
        )
        customer_rows = {row.type: row for row in result.scalars().all()}

        # Fetch global defaults for any missing types
        missing_types = ALL_TYPES - customer_rows.keys()
        if missing_types:
            result = await self.session.execute(
                select(ConfigurationCovariate)
                .where(
                    ConfigurationCovariate.customer_id.is_(None),
                    ConfigurationCovariate.type.in_(missing_types),
                )
            )
            for row in result.scalars().all():
                customer_rows[row.type] = row

        return sorted(customer_rows.values(), key=lambda r: r.type)

    async def resolve_active_types(self, customer_id: str) -> set[int]:
        """Return the set of active covariate type integers for a customer."""
        rows = await self.list_for_customer(customer_id)
        return {row.type for row in rows if row.active}

    async def update(self, covariate_id: str, active: bool) -> ConfigurationCovariate | None:
        """Toggle a covariate's active status."""
        result = await self.session.execute(
            select(ConfigurationCovariate).where(ConfigurationCovariate.id == covariate_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            return None
        row.active = active
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def ensure_customer_rows(self, customer_id: str) -> list[ConfigurationCovariate]:
        """Create customer-specific copies of global defaults if they don't exist.

        Call this when a customer first customizes their covariate settings so
        toggling one type doesn't affect the global default.
        """
        result = await self.session.execute(
            select(ConfigurationCovariate)
            .where(ConfigurationCovariate.customer_id == customer_id)
        )
        existing = {row.type for row in result.scalars().all()}

        missing_types = ALL_TYPES - existing
        if missing_types:
            globals_ = await self.list_global()
            for g in globals_:
                if g.type in missing_types:
                    row = ConfigurationCovariate(
                        customer_id=customer_id,
                        name=g.name,
                        description=g.description,
                        type=g.type,
                        active=g.active,
                    )
                    self.session.add(row)
            await self.session.flush()

        return await self.list_for_customer(customer_id)
