"""Service for kline (OHLCV) data operations."""

from datetime import datetime

from sqlalchemy import and_, desc, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.kline import Kline
from crypto_ai.schemas.kline import KlineCreate, KlineUpdate


class KlineService:
    """Service for managing kline data."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: KlineCreate) -> Kline:
        """Create a new kline."""
        kline = Kline(**data.model_dump())
        self.session.add(kline)
        await self.session.flush()
        return kline

    async def create_many(self, klines: list[KlineCreate]) -> list[Kline]:
        """Create multiple klines."""
        objs = [Kline(**k.model_dump()) for k in klines]
        self.session.add_all(objs)
        await self.session.flush()
        return objs

    async def get(self, kline_id: str) -> Kline | None:
        """Get a kline by ID."""
        result = await self.session.execute(
            select(Kline).where(Kline.id == kline_id)
        )
        return result.scalars().first()

    async def get_all(
        self,
        coin_id: str | None = None,
        quote_asset: str | None = None,
        interval: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Kline]:
        """Get klines with optional filtering by coin, quote asset, interval, and time range."""
        stmt = select(Kline).where(Kline.active == True)

        if coin_id:
            stmt = stmt.where(Kline.coin_id == coin_id)
        if quote_asset:
            stmt = stmt.where(Kline.quote_asset == quote_asset)
        if interval:
            stmt = stmt.where(Kline.interval == interval)
        if start_time:
            stmt = stmt.where(Kline.open_time >= start_time)
        if end_time:
            stmt = stmt.where(Kline.open_time <= end_time)

        stmt = stmt.order_by(Kline.open_time).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def get_by_coin_and_interval(
        self,
        coin_id: str,
        interval: str,
        limit: int = 500,
    ) -> list[Kline]:
        """Get klines for a specific coin and interval, ordered by time."""
        stmt = (
            select(Kline)
            .where(and_(Kline.coin_id == coin_id, Kline.interval == interval, Kline.active == True))
            .order_by(Kline.open_time)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def get_latest(self, coin_id: str, interval: str) -> Kline | None:
        """Get the latest kline for a coin and interval."""
        stmt = (
            select(Kline)
            .where(and_(Kline.coin_id == coin_id, Kline.interval == interval, Kline.active == True))
            .order_by(desc(Kline.open_time))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def update(self, kline_id: str, data: KlineUpdate) -> Kline | None:
        """Update a kline."""
        kline = await self.get(kline_id)
        if not kline:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(kline, key, value)

        self.session.add(kline)
        await self.session.flush()
        return kline

    async def delete(self, kline_id: str, hard_delete: bool = False) -> bool:
        """Delete a kline (soft delete by default)."""
        kline = await self.get(kline_id)
        if not kline:
            return False

        if hard_delete:
            await self.session.delete(kline)
        else:
            kline.active = False
            self.session.add(kline)

        await self.session.flush()
        return True

    async def delete_by_filters(self, coin_id: str, quote_asset: str, interval: str) -> int:
        """Delete all klines matching the given filters."""
        stmt = (
            select(Kline)
            .where(
                and_(
                    Kline.coin_id == coin_id,
                    Kline.quote_asset == quote_asset,
                    Kline.interval == interval,
                )
            )
        )
        result = await self.session.execute(stmt)
        klines = result.scalars().all()

        for kline in klines:
            kline.active = False
            self.session.add(kline)

        await self.session.flush()
        return len(klines)

    async def get_quote_assets_by_coin(self, coin_id: str) -> list[str]:
        """Get all unique quote assets for a coin."""
        stmt = select(distinct(Kline.quote_asset)).where(
            and_(Kline.coin_id == coin_id, Kline.active == True)
        )
        result = await self.session.execute(stmt)
        return sorted(result.scalars().all())

    async def get_pair_counts_by_coin(self) -> dict[str, int]:
        """Number of distinct trading pairs (quote assets) with loaded data, per coin id."""
        stmt = (
            select(Kline.coin_id, func.count(distinct(Kline.quote_asset)))
            .where(Kline.active == True)
            .group_by(Kline.coin_id)
        )
        result = await self.session.execute(stmt)
        return {str(coin_id): count for coin_id, count in result.all()}

    async def get_last_updated_by_coin(self) -> dict[str, datetime]:
        """Most recent updated_at across loaded klines, per coin id.

        Reflects when we last imported new data for the coin (re-imports only touch
        rows they insert), so it drives the "Last updated" column on the coins page.
        """
        stmt = (
            select(Kline.coin_id, func.max(Kline.updated_at))
            .where(Kline.active == True)  # noqa: E712
            .group_by(Kline.coin_id)
        )
        result = await self.session.execute(stmt)
        return {str(coin_id): ts for coin_id, ts in result.all()}

    async def get_avg_daily_volume_by_coin(self, days: int = 30) -> dict[str, float]:
        """Average quote-asset volume over the most recent `days` daily bars, per coin.

        Uses the 1d/USDT series and averages the last N bars (by recency, not a
        calendar window) so the metric stays stable when imports lag. The result
        is a coin's typical traded value in USDT — a size/liquidity ranking that
        drives the "Volume (30d)" column on the coins page.
        """
        rn = func.row_number().over(
            partition_by=Kline.coin_id,
            order_by=desc(Kline.open_time),
        ).label("rn")
        recent = (
            select(Kline.coin_id.label("coin_id"), Kline.quote_asset_volume.label("qv"), rn)
            .where(
                and_(
                    Kline.interval == "1d",
                    Kline.quote_asset == "USDT",
                    Kline.active == True,  # noqa: E712
                )
            )
            .subquery()
        )
        stmt = (
            select(recent.c.coin_id, func.avg(recent.c.qv))
            .where(recent.c.rn <= days)
            .group_by(recent.c.coin_id)
        )
        result = await self.session.execute(stmt)
        return {str(coin_id): float(avg) for coin_id, avg in result.all() if avg is not None}

    async def get_date_range(
        self, coin_id: str, quote_asset: str, interval: str
    ) -> tuple[datetime | None, datetime | None]:
        """Earliest and latest open_time for a coin/pair/timeframe (None if no data)."""
        stmt = select(func.min(Kline.open_time), func.max(Kline.open_time)).where(
            and_(
                Kline.coin_id == coin_id,
                Kline.quote_asset == quote_asset,
                Kline.interval == interval,
                Kline.active == True,  # noqa: E712
            )
        )
        lo, hi = (await self.session.execute(stmt)).one()
        return lo, hi

    async def get_loaded_combos(
        self, coin_id: str
    ) -> list[tuple[str, str, datetime | None]]:
        """Every (quote_asset, interval) with data for a coin, plus its latest bar time.

        Used to refresh all loaded series from Binance in one go: each combo is
        topped up from its last bar to now.
        """
        stmt = (
            select(Kline.quote_asset, Kline.interval, func.max(Kline.open_time))
            .where(and_(Kline.coin_id == coin_id, Kline.active == True))  # noqa: E712
            .group_by(Kline.quote_asset, Kline.interval)
            .order_by(Kline.quote_asset, Kline.interval)
        )
        result = await self.session.execute(stmt)
        return [(qa, iv, hi) for qa, iv, hi in result.all()]

    async def get_intervals_by_coin_and_quote(self, coin_id: str, quote_asset: str) -> list[str]:
        """Get all unique intervals for a trading pair."""
        stmt = select(distinct(Kline.interval)).where(
            and_(
                Kline.coin_id == coin_id,
                Kline.quote_asset == quote_asset,
                Kline.active == True,
            )
        )
        result = await self.session.execute(stmt)
        return sorted(result.scalars().all())
