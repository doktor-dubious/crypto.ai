"""A single paper trade: one complete (or still-open) round-trip position.

This is the authoritative, self-contained record of what the strategy actually
did — one row per trade, with the buy and the sell folded together (unlike the
low-level per-leg data the engine works with internally). Each row captures:

  * trade specifics — side, size, entry time/price, exit time/price, the fee
    applied, the fee-inclusive return, realised quote P/L, and why it closed;
  * a full snapshot of the strategy template it was traded under — the template
    id, name, strategy slug, scope (coin/pair/timeframe) and the complete
    parameter blob — so a later edit (or deletion) of the template never
    changes the historical record of how this trade was taken;
  * an AI verdict — a GO / NO_GO call and a free-text explanation — populated by
    a later review pass (nullable until then).

The engine upserts these each tick keyed on ``(run_id, trade_seq)``: the trade
outcome fields are refreshed as an open trade closes, while the template
snapshot and the AI verdict are written once and preserved.
"""

from datetime import datetime

from sqlalchemy import (
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


class PaperTrade(Base):
    """One round-trip paper trade with its template snapshot and AI verdict."""

    __tablename__ = "paper_trade"
    __table_args__ = (
        UniqueConstraint("run_id", "trade_seq", name="uq_paper_trade_run_seq"),
    )

    run_id: Mapped[str] = mapped_column(
        ForeignKey("paper_trade_run.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Stable index of this trade within its run (append-only replay order).
    trade_seq: Mapped[int] = mapped_column(Integer, nullable=False)

    # ── Trade specifics ───────────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(
        String(8), nullable=False, server_default=text("'open'")
    )  # "open" | "closed"
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # "long" | "short"
    qty: Mapped[float] = mapped_column(Float, nullable=False)  # base-asset units
    entry_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    exit_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    fee_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    ret: Mapped[float | None] = mapped_column(Float, nullable=True)  # fee-inclusive
    realized_pnl: Mapped[float | None] = mapped_column(Float, nullable=True)  # quote
    exit_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # ── Strategy-template snapshot (frozen at trade time) ─────────────────────
    template_id: Mapped[str | None] = mapped_column(String, nullable=True)
    template_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    strategy: Mapped[str | None] = mapped_column(String(50), nullable=True)
    scope: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # ── AI verdict (populated by a later review pass) ─────────────────────────
    ai_verdict: Mapped[str | None] = mapped_column(String(8), nullable=True)  # "GO" | "NO_GO"
    ai_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
