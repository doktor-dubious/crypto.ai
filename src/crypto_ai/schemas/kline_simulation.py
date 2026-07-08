"""Schemas for persisted kline simulation runs."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


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
    # Bars per forecast step. 1 = classic next-bar walk-forward. H>1 forecasts
    # the close H bars ahead over non-overlapping windows and scores the H-bar
    # move — the local trend rather than the next wiggle. Price strategy only.
    horizon: int = Field(default=1, ge=1, le=168)
    # Swing-signal covariates: "off" | "native" (model-side covariate API —
    # timesfm/chronos2 only) | "external" (trailing Ridge on the walk-forward's
    # own residual history — any engine). None falls back to use_covariates.
    covariate_mode: str | None = None
    # Deprecated boolean form of covariate_mode (true == "native"); kept so
    # older clients and pre-mode rerun payloads keep working.
    use_covariates: bool = False
    # Route the task to a specific worker's queue (its WORKER_NAME). None/""
    # = any available worker (the default "celery" queue).
    worker: str | None = None


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
    # Price skill in [-1, 1]: directional return IC (computed for every run).
    score: float | None = None
    # Significance of the price score (t-statistic); sortable to screen many
    # runs for statistically real edge. Under pure chance across ~1000 runs the
    # max is ~3.5, so values >= 4 mark genuine discovery candidates.
    score_t: float | None = None
    # Volatility skill (Pearson corr of predicted vs realized range-vol) and
    # its significance — only set for runs with forecast_vol on. Separate from
    # `score` so each column sorts a single, comparable metric.
    score_vol: float | None = None
    score_vol_t: float | None = None
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


class BacktestTradeMarker(BaseModel):
    """A single trade: its entry timestamp, net return (>0 = winning), and side."""

    timestamp: datetime
    ret: float
    side: str = "long"  # "long" | "short"
    # Exit bar for fixed-hold strategies (swing analysis) — lets the UI shade
    # the hold window during which new signals are ignored. Null for the
    # per-bar backtest, whose trades have no fixed exit.
    exit_timestamp: datetime | None = None


class BacktestResponse(BaseModel):
    """Fee-aware long-only backtest of a confidence-thresholded strategy."""

    model: str
    strategy: str = "price"
    vol_mode: str | None = None
    vol_source: str | None = None  # "forecast" (genuine pred_vol) | "band" (quantile width)
    position_sizing: str = "none"  # "none" | "conviction" | "pyramiding"
    pyramid_steps: int = 4  # bars to reach full size when position_sizing="pyramiding"
    threshold: float
    fee_bps: float
    min_edge_pct: float
    cover_fees: bool = False
    allow_short: bool = False  # long/short when True, long-only when False
    effective_min_edge_pct: float = 0.0  # min_edge_pct plus the round-trip fee when cover_fees is on
    periods_per_year: int
    n_bars: int
    n_trades: int
    n_fills: int = 0
    long_bars: int
    short_bars: int = 0
    exposure_pct: float
    win_rate_pct: float
    total_return_pct: float
    buy_hold_return_pct: float
    avg_return_per_trade_pct: float
    sharpe: float
    max_drawdown_pct: float
    equity_curve: list[BacktestPoint]
    trade_markers: list[BacktestTradeMarker] = []


class SwingSegmentStats(BaseModel):
    """Swing-strategy performance over one time segment.

    The first-half / second-half split is the built-in overfitting check: a
    knob setting that only works in one half is curve-fit, not edge.
    """

    label: str
    n_trades: int
    win_rate_pct: float
    avg_net_bps: float  # mean net return per trade, after fees, in bps
    edge_t: float  # t-statistic of per-trade net returns vs zero
    total_return_pct: float
    buy_hold_return_pct: float
    sharpe: float
    max_drawdown_pct: float


class SwingSignalDiag(BaseModel):
    """One composite member's state at the bars actually entered on.

    For z components: mean direction-aware contribution (positive = pushed the
    composite toward the entry). For flags: fraction of entries where it fired.
    Disabled members are still measured so their would-be state stays visible.
    """

    key: str
    name: str
    enabled: bool
    # Contribution multiplier applied to this member (1.0 = equal-weight baseline).
    weight: float = 1.0
    mean_z_at_entry: float | None


class SwingSignalPoint(BaseModel):
    """One charted bar of the composite + its component contributions.

    ``long_score``/``short_score`` are the two composites; the component
    fields are direction-aware contributions for the traded side (see
    ``SwingAnalysisResponse.components_side``). Null = insufficient trailing
    history at that bar.
    """

    timestamp: datetime
    long_score: float | None = None
    short_score: float | None = None
    streak: float | None = None
    volume: float | None = None
    range: float | None = None
    trades: float | None = None
    avg_trade: float | None = None
    wick: float | None = None
    taker: float | None = None
    stretch: float | None = None


class SwingAnalysisResponse(BaseModel):
    """Retrospective swing/crest composite backtest over a run's klines."""

    threshold: float
    hold_bars: int  # maximum hold — SL/TP exits can end a trade earlier
    fee_bps: float
    side: str  # "long" | "short" | "both"
    # Stop loss: "none" | "pct" | "atr" | "structure" | "trail_atr".
    # sl_value = % for pct, ATR multiple for atr/trail_atr (unused: structure).
    sl_mode: str = "none"
    sl_value: float = 2.0
    # Take profit: "none" | "pct" | "resistance" | "reversal" | "mean".
    # tp_value = % for pct (unused by the level/signal modes).
    tp_mode: str = "none"
    tp_value: float = 3.0
    # Per-member contribution multipliers actually applied (1.0 = baseline).
    weights: dict[str, float] = {}
    # How trades actually exited: stop / take_profit / reversal / hold_max.
    exit_counts: dict[str, int] = {}
    use_model: bool
    model_available: bool  # run had stored prob_up forecasts to confirm with
    n_bars: int
    long_entries: int
    short_entries: int
    vetoed_tops: int  # top signals suppressed by the breakout veto
    segments: list[SwingSegmentStats]
    signals: list[SwingSignalDiag]
    equity_curve: list[BacktestPoint]
    trade_markers: list[BacktestTradeMarker]
    # Per-bar composite + component values (bucket-max decimated so entry
    # spikes survive). Which side the component values describe:
    signal_curve: list[SwingSignalPoint] = []
    components_side: str = "long"


class SwingOptimizeStats(BaseModel):
    """Slim per-segment stats for one swept combo."""

    n_trades: int
    win_rate_pct: float
    avg_net_bps: float
    edge_t: float
    total_return_pct: float


class SwingOptimizeCombo(BaseModel):
    """One swept knob combination with train / validation / full-range results.

    Tuned (ranked) on the TRAIN half only; the validation half is untouched by
    the selection, so it is the honest read on each combo.
    """

    threshold: float
    hold_bars: int
    side: str
    sl_mode: str
    sl_value: float
    tp_mode: str
    tp_value: float
    signals: list[str]
    train: SwingOptimizeStats
    val: SwingOptimizeStats
    full: SwingOptimizeStats


class SwingOptimizeResponse(BaseModel):
    """Result of the bounded swing-knob sweep."""

    evaluated: int
    total_combos: int
    partial: bool  # time budget hit before the whole (shuffled) grid ran
    fee_bps: float
    use_model: bool
    model_available: bool
    split_at: datetime  # first bar of the validation half
    results: list[SwingOptimizeCombo]


class ScalpSignalPoint(BaseModel):
    """One charted bar of a scalp strategy's entry scores (σ-like units)."""

    timestamp: datetime
    long_score: float | None = None
    short_score: float | None = None


class ScalpAnalysisResponse(BaseModel):
    """Scalping-strategy backtest over an explicit kline scope.

    Same honesty framework as the swing explorer: fee-aware non-overlapping
    trades, SL/TP/hold-max exits, and Full/First-half/Second-half segments
    (the half split is the built-in overfitting check).
    """

    strategy: str  # "range" | "momentum" | "indicator" | "streak" | "sweep" | "takerflow"
    indicator: str  # for strategy="indicator": "ema" | "rsi" | "bollinger" | "vwap"
    params: dict[str, float]  # strategy parameters actually applied
    # Volatility-regime gate: entries restricted to calm/expanding regimes
    # (14-bar ATR vs its trailing 200-bar median, compared to vol_level).
    vol_gate: str = "off"
    vol_level: float = 1.0
    threshold: float
    hold_bars: int
    fee_bps: float
    side: str
    sl_mode: str
    sl_value: float
    tp_mode: str
    tp_value: float
    n_bars: int
    long_entries: int
    short_entries: int
    exit_counts: dict[str, int]
    segments: list[SwingSegmentStats]
    equity_curve: list[BacktestPoint]
    trade_markers: list[BacktestTradeMarker]
    signal_curve: list[ScalpSignalPoint]


class KlineSimulationStatusResponse(BaseModel):
    """Live status + progress for a running simulation, result when finished."""

    id: str
    task_id: str | None
    status: str
    progress: int
    progress_message: str | None
    error: str | None
    result: dict | None
