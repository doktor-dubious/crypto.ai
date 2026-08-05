"""Mark-to-market equity snapshot for a live run, one per processed bar.

Same contract as ``paper_trade_equity``: the run's time-bucketed P/L is
``equity(now) − equity(now − window)`` differenced from these snapshots, and the
series doubles as the equity curve. Keyed uniquely on ``(run_id, bar_time)``.
"""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class LiveTradeEquity(Base):
    """One mark-to-market equity point for a live run at a bar close."""

    __tablename__ = "live_trade_equity"
    __table_args__ = (
        UniqueConstraint("run_id", "bar_time", name="uq_live_equity_run_bar"),
    )

    run_id: Mapped[str] = mapped_column(
        ForeignKey("live_trade_run.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bar_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    equity: Mapped[float] = mapped_column(Float, nullable=False)
