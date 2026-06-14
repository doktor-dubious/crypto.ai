"""Schemas for persisted kline simulation runs."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class KlineSimulationCreate(BaseModel):
    """Request to create + enqueue a walk-forward simulation."""

    coin_id: str
    quote_asset: str
    interval: str
    start_date: date
    end_date: date
    models: list[str]
    name: str | None = None
    description: str | None = None
    # "price" (default) or "kline" (not yet implemented).
    strategy: str = "price"
    # Strategy-specific options (currently unused for new sims).
    config: dict | None = None
    # When true, the run ALSO forecasts a realized-volatility series one step
    # ahead (≈2x runtime), enabling genuine vol-aware backtests.
    forecast_vol: bool = False


class KlineSimulationUpdate(BaseModel):
    """Editable fields on a simulation record."""

    starred: bool | None = None


class KlineSimulationResponse(BaseModel):
    """A simulation run, enriched with the coin symbol for display."""

    id: str
    coin_id: str
    coin_symbol: str | None = None
    quote_asset: str
    interval: str
    start_date: date
    end_date: date
    models: list[str]
    name: str | None = None
    description: str | None = None
    strategy: str = "price"
    config: dict | None = None
    task_id: str | None = None
    status: str
    finished_at: datetime | None = None
    result: dict | None = None
    error: str | None = None
    starred: bool
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class KlineSimulationListResponse(BaseModel):
    """Paginated list of simulation runs."""

    items: list[KlineSimulationResponse]
    total: int


class KlineSimulationPredictionResponse(BaseModel):
    """A single persisted forecast row."""

    id: str
    model_name: str
    timestamp: datetime
    actual: float
    predicted: float
    error: float
    pct_error: float
    prev_close: float | None = None
    quantiles: list[float] | None = None
    prob_up: float | None = None
    in_interval: bool | None = None
    pred_vol: float | None = None
    realized_vol: float | None = None

    model_config = ConfigDict(from_attributes=True)


class KlineSimulationPredictionListResponse(BaseModel):
    """Paginated predictions, plus distinct models and 80%-band coverage."""

    items: list[KlineSimulationPredictionResponse]
    total: int
    models: list[str]
    coverage_inside: int  # rows where actual fell inside [P10, P90]
    coverage_total: int  # rows that have a band (quantiles)
    mape: float | None = None  # mean absolute percentage error over the set


class BacktestPoint(BaseModel):
    """One point on the equity curve."""

    timestamp: datetime
    strategy: float
    buy_hold: float


class BacktestResponse(BaseModel):
    """Fee-aware long-only backtest of a confidence-thresholded strategy."""

    model: str
    strategy: str = "price"
    vol_mode: str | None = None
    vol_source: str | None = None  # "forecast" (genuine pred_vol) | "band" (quantile width)
    threshold: float
    fee_bps: float
    min_edge_pct: float
    periods_per_year: int
    n_bars: int
    n_trades: int
    long_bars: int
    exposure_pct: float
    win_rate_pct: float
    total_return_pct: float
    buy_hold_return_pct: float
    avg_return_per_trade_pct: float
    sharpe: float
    max_drawdown_pct: float
    equity_curve: list[BacktestPoint]


class KlineSimulationStatusResponse(BaseModel):
    """Live status + progress for a running simulation, result when finished."""

    id: str
    task_id: str | None
    status: str
    progress: int
    progress_message: str | None
    error: str | None
    result: dict | None
