"""Prediction Pydantic schemas."""

from datetime import date, datetime
from enum import StrEnum
from typing import Optional

from pydantic import BaseModel, ConfigDict


class PredictionEngine(StrEnum):
    """Available prediction engines."""

    STATISTICAL = "statistical"
    TIMESFM = "timesfm"
    TIMESFM_FINETUNED = "timesfm_finetuned"
    CUSTOM = "custom"
    GLUON_CHRONOS_BOLT = "gluon-chronos-bolt"
    GLUON_CHRONOS2 = "gluon-chronos2"
    GLUON_TOTO = "gluon-toto"
    CHRONOS2 = "chronos2"
    CHRONOS_BOLT = "chronos-bolt"
    SUNDIAL = "sundial"
    MOIRAI2 = "moirai2"


class TaskStatus(StrEnum):
    """Task status values."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class PredictionRequest(BaseModel):
    """Schema for requesting a prediction."""

    customer_id: str
    outlet_ids: list[str] | None = None       # None = all active outlets for customer
    outlet_group_id: str | None = None
    prediction_from: date
    prediction_to: date
    delay: int = 0                            # days to subtract from prediction_from when cutting off historical data
    use_financials: bool = True               # include per-outlet weekday cost/profit covariates
    use_pad: bool = True                      # include pad event date covariates
    engine: PredictionEngine | None = None    # falls back to customer/global config then STATISTICAL
    engine_params: dict | None = None
    batch_size: int = 32                      # outlets per forward pass (increase for GPU, decrease if OOM)
    prediction_strategy_id: str | None = None  # FK to prediction_strategies
    increase_total_by: int | None = None      # extra copies to distribute greedily per date
    increase_total_by_pct: float | None = None  # extra copies as % of total base delivered per date
    increase_outlets_by: int | None = None    # flat copies added to every outlet before delivery constraints
    increase_outlets_by_pct: float | None = None  # % of each outlet's base added before delivery constraints
    fixed_total_delivery: int | None = None   # distribute exactly this many copies per date via greedy heap (bypasses base + delivery constraints)
    total_return_pct: float | None = None     # target overall return % across all outlets; profit-optimal per-outlet allocation via Lagrange multiplier
    target_return_pct: float | None = None    # uniform per-outlet return target: deliver at the (100-R)th demand percentile per outlet
    outlet_return_percentage: dict[str, float] | None = None  # per-outlet target return %; overrides target_return_pct for matched outlets
    ignore_fixed: bool = False       # ignore outlet delivery fixed constraint
    ignore_minimum: bool = False     # ignore outlet delivery minimum constraint
    ignore_maximum: bool = False     # ignore outlet delivery maximum constraint
    worker: str | None = None        # route to a specific worker queue; None = any available


class PredictionResult(BaseModel):
    """Schema for a single prediction result."""

    date: date
    predicted_value: float
    lower_bound: float | None = None
    upper_bound: float | None = None
    confidence: float | None = None
    economic_optimal: float | None = None  # Newsvendor-optimal draw based on profit/cost margin
    quantiles: list[float] | None = None  # P10..P90 (9 values at 0.1, 0.2, ..., 0.9)
    cv: float | None = None  # per-weekday coefficient of variation


class OutletPrediction(BaseModel):
    """Prediction results for a single outlet."""

    outlet_id: str
    results: list[PredictionResult]


class PredictionResponse(BaseModel):
    """Schema for prediction response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    engine: PredictionEngine
    horizon: int
    outlets: list[OutletPrediction]
    created_at: datetime


class MarginalValueRequest(BaseModel):
    """Request to rank outlets by their probability of selling one more copy."""

    customer_id: str
    date: date
    outlet_ids: list[str] | None = None      # None = resolve from outlet_group_id or all active
    outlet_group_id: str | None = None


class MarginalValueOutlet(BaseModel):
    """Marginal sale probability result for a single outlet."""

    outlet_id: str
    predicted: float                          # P50 point forecast
    lower_bound: float | None                 # P10
    upper_bound: float | None                 # P90
    eo: float | None                          # economic optimal
    delivered: float | None                   # recommended delivery
    marginal_sale_probability: float          # P(demand > delivered)


class MarginalValueResponse(BaseModel):
    """Outlets ranked by probability of selling one more copy, highest first."""

    date: date
    outlets: list[MarginalValueOutlet]        # sorted descending by marginal_sale_probability
    missing_outlets: list[str]                # outlet_ids with no prediction for this date


class PredictionTaskStatus(BaseModel):
    """Schema for prediction task status."""

    task_id: str
    status: TaskStatus
    progress: float = 0.0
    message: str | None = None
    result: PredictionResponse | None = None
    created_at: datetime
    completed_at: datetime | None = None


# ── Prediction Strategy schemas ───────────────────────────────────────────────

class PredictionStrategyCreate(BaseModel):
    """Schema for creating a prediction strategy."""

    customer_id: str
    name: str
    description: str | None = None
    type: int = 1


class PredictionStrategyUpdate(BaseModel):
    """Schema for updating a prediction strategy (all fields optional)."""

    name: str | None = None
    description: str | None = None
    type: int | None = None
    prediction_engine_id: str | None = None
    increase_total_by_number: float | None = None
    increase_total_by_percentage: float | None = None
    increase_outlets_by_number: float | None = None
    increase_outlets_by_percentage: float | None = None
    fixed_total_draw: float | None = None
    total_return_percentage: float | None = None
    outlet_return_percentage: float | None = None
    ignore_fixed: bool | None = None
    ignore_minimum: bool | None = None
    ignore_maximum: bool | None = None


class CompletedPredictionResponse(BaseModel):
    """Schema for a completed prediction list item."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    status: str  # success | failure | revoked
    outlet_group_id: str | None
    outlet_group_name: str | None
    prediction_strategy_id: str | None
    strategy_name: str | None
    date: Optional[date]
    engine: str | None
    requested_engine: str | None = None
    engine_params: dict | None
    batch_size: int | None
    delay: int | None
    use_financials: bool | None
    use_pad: bool | None
    task_id: str | None
    outlet_count: int
    error: str | None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class PredictionAnalyticsSummary(BaseModel):
    """Aggregate analytics for a completed prediction."""

    outlet_count: int
    avg_predicted: float | None
    avg_confidence: float | None
    avg_eo: float | None
    total_delivered: float | None
    total_eo: float | None
    total_predicted: float | None
    total_lower_bound: float | None
    total_upper_bound: float | None
    min_predicted: float | None
    max_predicted: float | None


class CompletedPredictionListResponse(BaseModel):
    """Paginated list of completed predictions."""

    items: list[CompletedPredictionResponse]
    total: int


class PredictionComparisonItem(BaseModel):
    """Comparison metrics for a single prediction."""

    id: str
    name: str
    date: Optional[date]
    draw: float
    expected_demand: float
    expected_sale: float
    expected_return: float
    sold_out_pct: float
    expected_profit: float | None


class PredictionComparisonResponse(BaseModel):
    """Comparison of multiple predictions."""

    items: list[PredictionComparisonItem]


class PredictionEngineParameterResponse(BaseModel):
    """Schema for a prediction engine parameter."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    prediction_engine_id: str
    prediction_strategy_id: str | None
    name: str
    value: str
    parameter: str | None
    description: str | None
    sort_order: int
    selected: bool


class PredictionEngineParameterCreate(BaseModel):
    """Schema for creating a prediction engine parameter."""

    name: str
    value: str
    parameter: str | None = None
    description: str | None = None
    sort_order: int = 0


class PredictionEngineResponse(BaseModel):
    """Schema for prediction engine response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    slug: str
    name: str
    description: str | None
    notes: str | None


class PredictionEngineCreate(BaseModel):
    """Schema for creating a prediction engine."""

    slug: str
    name: str
    description: str | None = None
    notes: str | None = None


class PredictionEngineUpdate(BaseModel):
    """Schema for updating a prediction engine."""

    name: str | None = None
    description: str | None = None
    notes: str | None = None


class PredictionStrategyResponse(BaseModel):
    """Schema for prediction strategy response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    name: str
    description: str | None
    type: int
    prediction_engine_id: str | None
    increase_total_by_number: float | None
    increase_total_by_percentage: float | None
    increase_outlets_by_number: float | None
    increase_outlets_by_percentage: float | None
    fixed_total_draw: float | None
    total_return_percentage: float | None
    outlet_return_percentage: float | None
    ignore_fixed: bool
    ignore_minimum: bool
    ignore_maximum: bool
    active: bool
    created_at: datetime
    updated_at: datetime


class PadEffectResponse(BaseModel):
    """PAD effect estimate for one outlet on one event date."""

    outlet_id: str
    pad_date: date
    weekday: int                        # 1=Monday, 7=Sunday
    pad_predicted: float | None         # model prediction on the PAD date
    baseline_avg: float | None          # avg prediction on comparable non-PAD weekdays
    effect: float | None                # pad_predicted - baseline_avg
    effect_pct: float | None            # effect as % of baseline_avg
    baseline_count: int                 # number of baseline dates used
