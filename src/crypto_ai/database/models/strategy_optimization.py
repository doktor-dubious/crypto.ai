"""Parameter-grid optimizations for a trading strategy ("Optimize" tab).

An optimization backtests many VARIATIONS of one strategy — across coins,
timeframes and every signal/exit knob — and records what each one scored. It is
deliberately named "optimization" and not "sweep": a *paper sweep*
(``paper_sweep.py``) rotates real paper runs across the coin universe, and
``sweep`` is also the name of a scalping strategy. Three meanings on one screen
would be unreadable.

Two honesty rules are baked into the schema rather than left to the UI:

  * Every result carries TRAIN (first half) and VALIDATION (second half) stats
    separately from the full range. Ranking on the full range after searching
    thousands of combos is curve-fitting by construction — under pure noise the
    best |t| of N combos is about sqrt(2·ln N), which is ~3.7 at N=1000.
  * One combo per optimization is the strategy's CURRENT settings
    (``is_baseline``), so "did this beat what I already have" is answerable
    without re-running anything.
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class StrategyOptimization(Base):
    """One grid search over a strategy's variations."""

    __tablename__ = "strategy_optimization"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Strategy slug the grid belongs to (currently only "streak"). Results are
    # only meaningful against the explorer that produced them.
    strategy: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # The full variation request, verbatim from the create dialog: which coins /
    # timeframes / knob values vary, plus the values held FIXED (fees, gate
    # levels). Kept whole so an optimization can be re-run later on a different
    # date range and still mean the same thing.
    spec: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Deterministic seed for random coin picks and for grid sampling — without
    # it neither the selection nor the sample is reproducible.
    seed: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("42"))
    # Cap on combos actually run. When the full cartesian exceeds it the grid is
    # SAMPLED rather than truncated: random search beats an exhaustive grid at
    # equal cost once the space has this many dimensions.
    max_combos: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("500")
    )
    sampled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # Size of the full cartesian before sampling — the honest denominator.
    n_cartesian: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    # pending | running | success | error | stopped
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'pending'"), index=True
    )
    n_total: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    n_done: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # Combos skipped because their (coin, timeframe) had no usable klines.
    n_skipped: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class StrategyOptimizationResult(Base):
    """One variation's score. Stats only — never the individual trades.

    A grid of a few thousand combos over a year of 5m bars produces millions of
    trades; keeping them would cost far more than the search itself. The
    per-trade view is a click away: "Implement" applies the variation back onto
    the explorer, which recomputes it exactly.
    """

    __tablename__ = "strategy_optimization_result"

    optimization_id: Mapped[str] = mapped_column(
        ForeignKey("strategy_optimization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # The market this variation ran on. UUID, matching coin.id — a plain String
    # here is accepted by SQLAlchemy but rejected by Postgres on insert.
    coin_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("coin.id"), nullable=False
    )
    quote_asset: Mapped[str] = mapped_column(String(20), nullable=False)
    interval: Mapped[str] = mapped_column(String(10), nullable=False)
    # The explorer-shaped params, ready to apply straight back onto the page.
    params: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # The strategy's settings as they were when the optimization was created.
    is_baseline: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    # ── Scores ────────────────────────────────────────────────────────────────
    # Ranked on TRAIN, judged on VALIDATION. avg_net_bps is the cross-coin
    # comparable figure — total return is not, since coins move at wildly
    # different scales.
    n_trades: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    avg_net_bps: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    edge_t: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    win_rate_pct: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    total_return_pct: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("0")
    )

    train_n_trades: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    train_avg_net_bps: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("0")
    )
    train_edge_t: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))

    # ── Payoff shape ─────────────────────────────────────────────────────────
    # t and Sharpe assume roughly symmetric returns and mis-rank skewed payoffs
    # in both directions. Nullable: rows written before these existed genuinely
    # don't know, and 0 would claim "symmetric, no drawdown".
    skew: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_drawdown_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    worst_trade_bps: Mapped[float | None] = mapped_column(Float, nullable=True)

    val_n_trades: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    val_avg_net_bps: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("0")
    )
    val_edge_t: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
