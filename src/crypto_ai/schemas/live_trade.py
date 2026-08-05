"""Schemas for live-trade runs (Trading → Live page)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class LiveTradePnl(BaseModel):
    """Same contract as the paper P/L: total + trailing-window equity diffs."""

    total: float | None = None
    h1: float | None = None
    h3: float | None = None
    h6: float | None = None
    h12: float | None = None
    h24: float | None = None
    week: float | None = None
    month: float | None = None


class LiveTradeRunResponse(BaseModel):
    """A live run joined with its template's identity for the active view.

    Field-compatible with ``PaperTradeRunResponse`` (the active-strategies UI is
    shared), plus the live-only exchange state.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    template_id: str
    # What the user called this run; null on runs started before naming.
    name: str | None = None
    status: str
    started_at: datetime
    stopped_at: datetime | None = None
    uptime_s: int | None = None
    last_trade_at: datetime | None = None
    initial_capital: float = 100.0

    template_name: str
    strategy: str
    scope: dict[str, Any] | None = None

    n_trades: int = 0
    position: str | None = None  # "long" | None (spot is long-only)
    error: str | None = None

    # Live-only exchange state.
    is_testnet: bool = True
    cash_quote: float = 0.0
    open_qty: float | None = None

    pnl: LiveTradePnl = LiveTradePnl()


class LiveTradeResponse(BaseModel):
    """One live trade with real order/fill data + template snapshot + verdict."""

    model_config = ConfigDict(from_attributes=True)

    # Which run this trade belongs to. trade_seq restarts at 0 in every run, so
    # only (run_id, trade_seq) identifies a trade once several runs are pooled.
    run_id: str
    # Where the trade was executed: "testnet" or "live", from the RUN's
    # is_testnet flag (a trade row carries no venue of its own). Set by the
    # service, never inferred from the trade — same field the paper table fills
    # with "paper", so a merged view can sort the three apart.
    source: str = "testnet"

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

    # Exchange linkage.
    signal_time: datetime | None = None
    entry_order_id: int | None = None
    exit_order_id: int | None = None
    entry_commission: float | None = None
    exit_commission: float | None = None

    # Strategy-template snapshot, frozen at trade time.
    template_id: str | None = None
    template_name: str | None = None
    strategy: str | None = None
    scope: dict[str, Any] | None = None
    params: dict[str, Any] | None = None

    ai_verdict: str | None = None
    ai_explanation: str | None = None


class LiveTradeAccountResponse(BaseModel):
    """Exchange connectivity + balances for the Live page header."""

    configured: bool
    testnet: bool
    base_url: str
    can_trade: bool | None = None
    balances: dict[str, float] = {}
    error: str | None = None
