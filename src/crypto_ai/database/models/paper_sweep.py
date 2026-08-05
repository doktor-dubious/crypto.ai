"""A paper-trade sweep: rotate many (template × coin) combos through paper runs.

A sweep is a standing search for profitable strategy/coin combinations: an
ordered list of strategy templates crossed with an ordered (liquidity-ranked)
coin list. The hourly rotation task keeps up to ``max_concurrent`` combos
running as paper-trade runs, stops each run after ``dwell_days``, and tops back
up with the next untried combos. Progress lives in the runs themselves (a run
tagged ``sweep_id`` marks its combo as taken), so the sweep row is pure config.

Combo order is coin-major: every template runs on the top-ranked coins first,
so pooled per-template evidence across the same coins accumulates fastest.
"""

from sqlalchemy import Boolean, Float, Integer, String, text
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class PaperSweep(Base):
    """Config for one rotating strategy×coin paper-trading search."""

    __tablename__ = "paper_sweep"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Rotation only touches enabled sweeps; disabling freezes the fleet as-is
    # (running runs keep stepping until stopped by dwell on re-enable or by hand).
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    # Ordered template ids (the param-sets under test) and coin ids (priority
    # order — normally by recent quote volume). The combo queue is their
    # cartesian product, coin-major.
    template_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    coin_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    max_concurrent: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("75")
    )
    # How long each combo runs before being swapped for the next one.
    dwell_days: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("7")
    )
    initial_capital: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("100")
    )
