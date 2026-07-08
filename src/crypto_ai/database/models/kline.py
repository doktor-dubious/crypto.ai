"""Kline (OHLCV) data model for cryptocurrency price history."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Numeric, String, BigInteger, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.coin import Coin


class Kline(Base):
    """OHLCV candlestick data for a coin at a specific timeframe."""

    __tablename__ = "klines"

    coin_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("coin.id", ondelete="CASCADE"),
        index=True,
    )
    quote_asset: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        default="USDT",
        index=True,
        comment="Quote asset (USDT, USD, USDC, etc.)",
    )
    interval: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        index=True,
        comment="Timeframe: 5m, 15m, 1h, 4h, 1d, 1w, 1M",
    )
    open_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        comment="Kline open time (UTC)",
    )
    close_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        comment="Kline close time (UTC)",
    )
    open: Mapped[float] = mapped_column(
        Numeric(precision=20, scale=8),
        nullable=False,
        comment="Open price",
    )
    high: Mapped[float] = mapped_column(
        Numeric(precision=20, scale=8),
        nullable=False,
        comment="High price",
    )
    low: Mapped[float] = mapped_column(
        Numeric(precision=20, scale=8),
        nullable=False,
        comment="Low price",
    )
    close: Mapped[float] = mapped_column(
        Numeric(precision=20, scale=8),
        nullable=False,
        comment="Close price",
    )
    # Volume fields use unconstrained numeric: low-price/high-supply coins (e.g.
    # WINUSDT) can have a monthly base volume above 10^12, which overflows the
    # numeric(20,8) precision cap. Prices keep (20,8) — no asset trades near 10^12.
    volume: Mapped[float] = mapped_column(
        Numeric(),
        nullable=False,
        comment="Base asset volume",
    )
    quote_asset_volume: Mapped[float] = mapped_column(
        Numeric(),
        nullable=False,
        comment="Quote asset volume",
    )
    number_of_trades: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        comment="Number of trades in this period",
    )
    taker_buy_base_asset_volume: Mapped[float] = mapped_column(
        Numeric(),
        nullable=False,
        comment="Taker buy base asset volume",
    )
    taker_buy_quote_asset_volume: Mapped[float] = mapped_column(
        Numeric(),
        nullable=False,
        comment="Taker buy quote asset volume",
    )

    # Relationships
    coin: Mapped["Coin"] = relationship("Coin")

    # Unique composite index: one bar per (coin, quote, interval, open_time).
    # Also serves lookup queries; the importer upserts against it with
    # ON CONFLICT DO NOTHING so overlapping import ranges can't duplicate bars.
    __table_args__ = (
        Index(
            "idx_kline_coin_quote_interval_time",
            "coin_id", "quote_asset", "interval", "open_time",
            unique=True,
        ),
    )
