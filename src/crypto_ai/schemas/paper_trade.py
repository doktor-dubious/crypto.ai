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
    # What the user called this run; null on sweep runs (fall back to template_name).
    name: str | None = None
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

    # Which run this trade belongs to. trade_seq restarts at 0 in every run, so
    # only (run_id, trade_seq) identifies a trade once several runs are pooled.
    run_id: str
    # Where the trade was executed. Always "paper" here; the live table reports
    # "testnet" or "live" on the same field, so a merged view can sort them out.
    source: str = "paper"

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


class AnalysisKline(BaseModel):
    """One OHLCV bar in a trade-analysis window."""

    open_time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


class TradeSignalInfo(BaseModel):
    """Which bars determined a trade decision, plus values for the explanation.

    ``kind`` selects the (frontend, i18n'd) explanation template; ``data`` holds
    its interpolation values. ``mark_times`` are the open_times of the bars the
    signal was built from; ``anchor_time`` is the bar the explanation points at
    (the entry / exit bar itself).
    """

    kind: str
    mark_times: list[datetime] = []
    anchor_time: datetime | None = None
    data: dict[str, Any] = {}


class PaperTradeAnalysisResponse(BaseModel):
    """Kline snapshot around one paper trade's entry and exit, with signal marks.

    ``exit_klines`` is empty when the exit sits inside (or adjacent to) the
    entry window — then ``entry_klines`` covers the whole trade and
    ``gap_bars`` is 0. A positive ``gap_bars`` means the two windows are
    separated by that many hidden bars.
    """

    trade: PaperTradeResponse
    symbol: str
    quote_asset: str
    interval: str
    entry_klines: list[AnalysisKline]
    exit_klines: list[AnalysisKline] = []
    gap_bars: int = 0
    entry_signal: TradeSignalInfo | None = None
    exit_signal: TradeSignalInfo | None = None


class BacktestTradeAnalysisRequest(BaseModel):
    """One backtested round-trip, plus the setup that produced it.

    A backtest trade isn't stored anywhere — it is recomputed whenever a knob
    moves — so the popup can't look it up by id the way a paper trade is. The
    client sends the row it drew and the scope/parameters behind it, and gets
    back the identical chart payload.
    """

    coin_id: str
    quote_asset: str
    interval: str
    strategy: str
    params: dict[str, Any] = {}

    seq: int
    side: str
    entry_time: datetime
    entry_price: float
    exit_time: datetime | None = None
    exit_price: float | None = None
    ret_bps: float = 0.0
    exit_reason: str | None = None


class TradeDateRange(BaseModel):
    """The span a strategy has actually traded over, pooled across venues.

    Null bounds mean it has never traded — the caller then falls back to a
    default window rather than pretending there is a range.
    """

    first_entry: datetime | None = None
    last_exit: datetime | None = None
    n_trades: int = 0
