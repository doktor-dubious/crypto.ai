"""A single live trade: one real round-trip position on Binance (testnet or prod).

The live twin of ``paper_trade``. Where a paper trade's prices are synthesized
from the backtest replay, a live trade records what the exchange actually did:
the Binance order ids, the executed quantity, the average fill prices, and the
commissions reported per fill. ``signal_time`` keeps the replay's entry bar so
the engine can recognise a signal it has already acted on (or vetoed) and never
double-enter it. Rows are append-only per run, keyed on ``(run_id, trade_seq)``;
an open row is updated in place when its exit order fills.
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class LiveTrade(Base):
    """One round-trip live trade with real order/fill data + template snapshot."""

    __tablename__ = "live_trade"
    __table_args__ = (
        UniqueConstraint("run_id", "trade_seq", name="uq_live_trade_run_seq"),
    )

    run_id: Mapped[str] = mapped_column(
        ForeignKey("live_trade_run.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Stable index of this trade within its run (append-only).
    trade_seq: Mapped[int] = mapped_column(Integer, nullable=False)

    # ── Trade specifics (real fills; qty 0 = vetoed, never executed) ──────────
    status: Mapped[str] = mapped_column(
        String(8), nullable=False, server_default=text("'open'")
    )  # "open" | "closed"
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # "long" (spot)
    qty: Mapped[float] = mapped_column(Float, nullable=False)  # executed base qty
    entry_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)  # avg fill
    exit_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)  # avg fill
    fee_bps: Mapped[float | None] = mapped_column(Float, nullable=True)  # template knob
    ret: Mapped[float | None] = mapped_column(Float, nullable=True)  # realized, fee-incl.
    realized_pnl: Mapped[float | None] = mapped_column(Float, nullable=True)  # quote
    exit_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # ── Exchange linkage ───────────────────────────────────────────────────────
    # The strategy replay's entry bar for this signal — the engine's dedup key
    # against re-entering (or re-consulting the AI about) the same signal.
    signal_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    entry_order_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    exit_order_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Commission as reported by Binance per leg (asset varies; informational).
    entry_commission: Mapped[float | None] = mapped_column(Float, nullable=True)
    exit_commission: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ── Strategy-template snapshot (frozen at trade time) ─────────────────────
    template_id: Mapped[str | None] = mapped_column(String, nullable=True)
    template_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    strategy: Mapped[str | None] = mapped_column(String(50), nullable=True)
    scope: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # ── AI verdict (frozen at entry decision) ──────────────────────────────────
    ai_verdict: Mapped[str | None] = mapped_column(String(8), nullable=True)
    ai_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
