"""KlineSimulation model: a persisted walk-forward simulation run."""

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.coin import Coin


class KlineSimulation(Base):
    """A single walk-forward backtest run over a coin/pair/timeframe/date-range."""

    __tablename__ = "kline_simulation"

    # Optional human-friendly labelling (set from the New Simulation form).
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    coin_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("coin.id", ondelete="CASCADE"),
        index=True,
    )
    quote_asset: Mapped[str] = mapped_column(String(10), nullable=False)
    interval: Mapped[str] = mapped_column(String(10), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    models: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Simulation strategy: "price" (close-price forecast, the default/original),
    # "kline" (full-OHLC — not yet implemented), or "price_volatility" (price
    # forecast traded through a volatility-aware rule). Strategy-specific options
    # (e.g. {"vol_mode": "vol_targeting"|"vol_breakout"}) live in `config`.
    strategy: Mapped[str] = mapped_column(
        String(30), nullable=False, default="price", server_default=text("'price'")
    )
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    task_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default=text("'pending'"), index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    starred: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    coin: Mapped["Coin"] = relationship("Coin")
