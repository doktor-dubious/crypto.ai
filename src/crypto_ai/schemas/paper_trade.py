"""Schemas for paper-trade runs (Paper Trade page)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class PaperTradePnl(BaseModel):
    """Profit/loss for a run, in quote currency — total + trailing-window buckets.

    ``total`` is mark-to-market equity minus the run's starting capital; each
    bucket is ``equity(now) − equity(now − window)``. A field is null when the
    run has no equity yet (just started) or is younger than that window — the UI
    renders null as an em-dash.
    """

    total: float | None = None
    h1: float | None = None
    h3: float | None = None
    h6: float | None = None
    h12: float | None = None
    h24: float | None = None
    week: float | None = None
    month: float | None = None


class PaperTradeRunResponse(BaseModel):
    """A run joined with its template's identity for the active-strategies view."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    template_id: str
    status: str
    started_at: datetime
    stopped_at: datetime | None = None
    uptime_s: int | None = None
    last_trade_at: datetime | None = None
    initial_capital: float = 100.0

    # Denormalised template identity so the card renders without extra lookups.
    template_name: str
    strategy: str
    scope: dict[str, Any] | None = None

    # Live engine state.
    n_trades: int = 0
    position: str | None = None  # "long" | "short" | None (flat)
    error: str | None = None

    pnl: PaperTradePnl = PaperTradePnl()


class PaperTradeResponse(BaseModel):
    """One complete (or open) paper trade with its template snapshot + AI verdict."""

    model_config = ConfigDict(from_attributes=True)

    trade_seq: int
    status: str
    side: str
    qty: float
    entry_time: datetime
    entry_price: float
    exit_time: datetime | None = None
    exit_price: float | None = None
    fee_bps: float | None = None
    ret: float | None = None
    realized_pnl: float | None = None
    exit_reason: str | None = None

    # Strategy-template snapshot, frozen at trade time.
    template_id: str | None = None
    template_name: str | None = None
    strategy: str | None = None
    scope: dict[str, Any] | None = None
    params: dict[str, Any] | None = None

    # AI verdict (populated by a later review pass).
    ai_verdict: str | None = None
    ai_explanation: str | None = None
