"""Mark-to-market equity snapshot, one per bar the engine processes.

The run's time-bucketed P/L (1h / 3h / … / month) is just
``equity(now) − equity(now − window)``. Rather than recompute equity from fills
and klines at request time, the engine writes one snapshot per processed bar so
the P/L endpoint is a handful of indexed reads. The series also doubles as the
run's equity curve for future charting. Keyed uniquely on ``(run_id, bar_time)``
so a re-processed bar overwrites rather than duplicates.
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


class PaperTradeEquity(Base):
    """One mark-to-market equity point for a run at a bar close."""

    __tablename__ = "paper_trade_equity"
    __table_args__ = (
        UniqueConstraint("run_id", "bar_time", name="uq_paper_equity_run_bar"),
    )

    run_id: Mapped[str] = mapped_column(
        ForeignKey("paper_trade_run.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bar_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    equity: Mapped[float] = mapped_column(Float, nullable=False)
