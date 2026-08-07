"""Schemas for strategy parameter-grid optimizations."""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CoinSelection(BaseModel):
    """Which markets an optimization runs over.

    ``liquidity`` is accepted but not yet implemented — ranking coins by traded
    volume needs a metric the coin table doesn't carry — so it is rejected at
    create time rather than silently falling back to something else.
    """

    mode: str = "single"  # single | group | random | all | liquidity
    coin_id: str | None = None
    group_id: str | None = None
    count: int = Field(default=10, ge=1, le=500)
    quote_asset: str = "USDT"


class OptimizationCreate(BaseModel):
    """Create + enqueue a grid search."""

    name: str
    description: str | None = None
    notes: str | None = None
    strategy: str = "streak"

    coins: CoinSelection = CoinSelection()
    intervals: list[str] = ["15m"]
    start_date: date
    end_date: date

    # Varied axes. Empty means "hold at the fixed value" rather than "try none".
    #
    # The camelCase names below are deliberate and are why N815 is silenced: they
    # mirror the explorer's own parameter blob (holdBars, slMode, volGate, …), so
    # a variation round-trips from the dialog through the runner and back onto the
    # page with no translation layer to drift out of sync.
    threshold: list[float] = [3]
    holdBars: list[int] = [6]  # noqa: N815
    sides: list[str] = ["both"]
    voldiv: list[int] = [0]
    btcFilter: list[int] = [0]  # noqa: N815
    volGate: list[str] = ["off"]  # noqa: N815
    htfGate: list[str] = ["off"]  # noqa: N815
    slModes: list[str] = ["none"]  # noqa: N815
    slValues: dict[str, list[float]] = {}  # noqa: N815
    tpModes: list[str] = ["none"]  # noqa: N815
    tpValues: dict[str, list[float]] = {}  # noqa: N815
    # Signal knobs that differ per strategy: {"window": [24, 48]} for momentum,
    # and so on. Streak's two predate this and keep their own fields above.
    paramAxes: dict[str, list[float]] = {}  # noqa: N815
    # "indicator" strategy only: which indicator kinds to try, and each kind's
    # own knobs. Kept apart from paramAxes so a kind is only ever paired with
    # parameters it reads.
    indicators: list[str] = []
    indicatorValues: dict[str, dict[str, list[float]]] = {}  # noqa: N815
    # "swings" strategy only: which named composite subsets vote.
    signalSubsets: list[str] = []  # noqa: N815

    # Held constant across the whole grid: fees are a venue property, and the
    # gate LEVELS are shape parameters that would multiply the grid without
    # telling you much. The baseline's values are used unless overridden.
    fixed: dict[str, Any] = {}
    # The strategy's current settings, run as one combo so "did anything beat
    # what I already have" is answerable from the results alone.
    baseline: dict[str, Any] | None = None
    baseline_params: dict[str, Any] | None = None

    seed: int = 42
    # The budget, not a limit on the grid — anything larger is SAMPLED down to
    # this many combos. The ceiling is a guard against a typo turning into a
    # multi-day run, not a capacity limit: above 250k the expansion stops
    # materialising the cartesian, so the grid itself can be arbitrarily large.
    max_combos: int = Field(default=2500, ge=1, le=99999)


class OptimizationUpdate(BaseModel):
    """Rename / annotate an optimization."""

    name: str | None = None
    description: str | None = None
    notes: str | None = None


class OptimizationResponse(BaseModel):
    """An optimization with its progress."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None = None
    notes: str | None = None
    strategy: str
    spec: dict[str, Any] = {}
    start_date: date
    end_date: date
    seed: int
    max_combos: int
    sampled: bool
    n_cartesian: int
    status: str
    n_total: int
    n_done: int
    n_skipped: int
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    created_at: datetime

    # Derived for the master table's progress column.
    eta_seconds: int | None = None
    elapsed_seconds: int | None = None


class OptimizationResultResponse(BaseModel):
    """One variation's score."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    coin_id: str
    coin_symbol: str | None = None
    quote_asset: str
    interval: str
    params: dict[str, Any] = {}
    is_baseline: bool

    n_trades: int
    avg_net_bps: float
    edge_t: float
    win_rate_pct: float
    total_return_pct: float

    train_n_trades: int
    train_avg_net_bps: float
    train_edge_t: float

    val_n_trades: int
    val_avg_net_bps: float
    val_edge_t: float

    # Payoff shape over the full range. Null on results recorded before these
    # were measured — the UI shows an em-dash rather than inventing a zero.
    skew: float | None = None
    max_drawdown_pct: float | None = None
    worst_trade_bps: float | None = None

    # Enough trades on BOTH halves to be worth reading. A combo that traded 7
    # times can post a huge per-trade figure on noise alone, and unranked it
    # sits at the top of the table looking like a discovery.
    qualified: bool = False


class OptimizationEstimate(BaseModel):
    """What a spec would cost, before committing to it.

    ``n_markets`` is the real driver of wall-clock: every market pays a fresh
    kline load and feature computation, while combos within one are milliseconds.
    """

    n_markets: int
    n_param_combos: int
    n_cartesian: int
    n_to_run: int
    sampled: bool
    est_seconds: int
