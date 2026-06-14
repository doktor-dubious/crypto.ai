"""System configuration service for business logic."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models import Configuration
from crypto_ai.schemas.configuration import ConfigurationUpdate

SINGLETON_ID = "00000000-0000-0000-0000-000000000001"


class ConfigurationService:
    """Service for system configuration operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self) -> Configuration | None:
        """Get system configuration singleton."""
        result = await self.session.execute(
            select(Configuration).where(Configuration.id == SINGLETON_ID)
        )
        return result.scalar_one_or_none()

    async def update(self, data: ConfigurationUpdate) -> Configuration | None:
        """Update system configuration."""
        config = await self.get()
        if not config:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(config, field, value)

        await self.session.flush()
        await self.session.refresh(config)
        return config
