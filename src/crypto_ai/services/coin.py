"""Coin service."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.coin import Coin
from crypto_ai.schemas.coin import CoinCreate, CoinUpdate


class CoinService:
    """Coin service for CRUD operations."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialize service with database session."""
        self.session = session

    async def create(self, data: CoinCreate) -> Coin:
        """Create a new coin."""
        coin = Coin(**data.model_dump())
        self.session.add(coin)
        await self.session.flush()
        return coin

    async def get(self, id: str) -> Coin | None:
        """Get coin by id."""
        stmt = select(Coin).where(Coin.id == id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_all(
        self, limit: int = 100, offset: int = 0, include_inactive: bool = False
    ) -> list[Coin]:
        """Get all coins with pagination."""
        stmt = select(Coin).offset(offset).limit(limit)
        if not include_inactive:
            stmt = stmt.where(Coin.active.is_(True))
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def update(self, id: str, data: CoinUpdate) -> Coin | None:
        """Update a coin."""
        coin = await self.get(id)
        if not coin:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(coin, key, value)
        await self.session.flush()
        return coin

    async def set_categories(self, id: str, categories: list[str]) -> Coin | None:
        """Replace a coin's CoinGecko category tags."""
        coin = await self.get(id)
        if not coin:
            return None
        coin.categories = categories
        await self.session.flush()
        return coin

    async def set_markets(
        self, id: str, has_spot: bool | None, has_futures: bool | None
    ) -> Coin | None:
        """Update a coin's Binance market-availability flags. A ``None`` value is
        left untouched (source unavailable) so a transient outage can't wipe a
        previously-known flag."""
        coin = await self.get(id)
        if not coin:
            return None
        if has_spot is not None:
            coin.has_spot = has_spot
        if has_futures is not None:
            coin.has_futures = has_futures
        await self.session.flush()
        return coin

    async def delete(self, id: str, hard_delete: bool = False) -> bool:
        """Delete a coin."""
        coin = await self.get(id)
        if not coin:
            return False
        if hard_delete:
            await self.session.delete(coin)
        else:
            coin.active = False
        await self.session.flush()
        return True
