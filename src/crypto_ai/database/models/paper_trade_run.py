"""A paper-trade run: one live execution of a strategy template.

Starting a template from the Paper Trade page creates a run (status ``running``);
stopping it sets ``stopped_at`` and status ``stopped``. The execution engine
(``services/paper_trade_engine.py``) steps every running run forward as new bars
close: it replays the same trailing-only backtest the analytics pages use over
[started_at, now], records each entry/exit as a paper fill, and marks equity to
market. The engine-maintained columns below are a denormalised cache of that
state (all recomputable from the fills + klines) so the API is a plain read.
"""

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base

INITIAL_CAPITAL = 10_000.0  # notional quote each run starts with (paper USDT)


class PaperTradeRun(Base):
    """One start→stop run of a strategy template on live (paper) data."""

    __tablename__ = "paper_trade_run"

    template_id: Mapped[str] = mapped_column(
        ForeignKey("strategy_template.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # ── Template snapshot, frozen at start() ──────────────────────────────────
    # The engine replays against THIS snapshot, not the live template, so editing
    # (or deleting) the template mid-run never rewrites a running trade's history.
    # Each trade also copies these onto itself for a fully self-contained record.
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

    # ── Engine state (denormalised cache of the fills/equity replay) ──────────
    # Starting paper capital and the mark-to-market equity as of last_bar_time.
    initial_capital: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("10000")
    )
    equity: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Equity from CLOSED trades only (open position excluded) — the compounding base.
    realized_equity: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Current open position: 0 flat, 1 long, -1 short, with its entry fill.
    open_side: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    open_entry_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    open_entry_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Number of fully-closed trades replayed so far (fills cursor / trade count).
    n_closed_trades: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    # Newest bar close the engine has processed, and when it last ran.
    last_bar_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # When this run last traded — the open position's entry, else the most recent
    # closed trade's exit. Null until the first trade. Drives the active-list order.
    last_trade_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_step_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Last engine error for this run (surfaced in the UI); cleared on success.
    error: Mapped[str | None] = mapped_column(String, nullable=True)
