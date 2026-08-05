"""A live-trade run: one real-money (or testnet) execution of a strategy template.

The live twin of ``paper_trade_run``. Starting a template from the Live page
creates a run (status ``running``); the execution engine
(``services/live_trade_engine.py``) steps every running run forward as new bars
close. Unlike paper trading — which deterministically replays the backtest each
tick — a live run holds REAL exchange state: actual Binance order fills, an
actual base-asset position, and an actual quote-cash balance attributed to the
run. The engine therefore reconciles a *target* position (what the strategy's
replay says it should hold at the newest bar) against the run's actual position,
placing market orders for the difference. Spot accounts cannot short, so live
runs are long-only: short signals are skipped (noted on ``error``), and a
long→short flip just exits to flat.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class LiveTradeRun(Base):
    """One start→stop live-trading run of a strategy template."""

    __tablename__ = "live_trade_run"

    template_id: Mapped[str] = mapped_column(
        ForeignKey("strategy_template.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # ── Template snapshot, frozen at start() (same contract as paper runs) ────
    # What the user called THIS run, as opposed to template_name (the
    # strategy's own name frozen at start). Null on runs predating the column.
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    template_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    strategy: Mapped[str | None] = mapped_column(String(50), nullable=True)
    scope: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Lifecycle status: running | stopped | error.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'running'"), index=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    stopped_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # True when the run was started against the Spot testnet (frozen at start so
    # a later base-URL change can't relabel historical runs).
    is_testnet: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    # ── Real account state attributed to this run ──────────────────────────────
    # Quote budget the run started with, and the quote cash still unspent. The
    # exchange account is shared across runs, so each run tracks its own slice:
    # cash_quote goes down by the actual cost of a buy (fills + fees) and up by
    # the actual proceeds of a sell.
    initial_capital: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("100")
    )
    cash_quote: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("0")
    )
    # Mark-to-market equity (cash + position × last close) as of last_bar_time.
    equity: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Current open position: 0 flat, 1 long (spot is long-only), with the actual
    # filled quantity and average fill price.
    open_side: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    open_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    open_entry_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    open_entry_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Quote actually spent entering the open position (cost basis incl. fees) —
    # the denominator for the eventual realized return.
    open_entry_quote: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Number of recorded closed trades (vetoed entries included, like paper).
    n_closed_trades: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    # Newest bar close the engine has processed, and when it last ran.
    last_bar_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_trade_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_step_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Last engine error for this run (surfaced in the UI); cleared on success.
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    # Consecutive AI-advisor failures (same fail-closed contract as paper runs).
    ai_consult_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
