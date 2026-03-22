"""Simulation Pydantic schemas."""

from datetime import date, datetime
from enum import IntEnum

from pydantic import BaseModel, ConfigDict


class SimulationGroup(IntEnum):
    """Classification of a predicted vs actual day."""

    GOOD_REDUCTION = 1  # predicted < delivered, predicted >= actual_sale (no lost sales)
    BAD_REDUCTION = 2   # predicted < actual_sale (lost sales)
    BAD_INCREASE = 3    # predicted > delivered, outlet not sold out
    GOOD_INCREASE = 4   # predicted > delivered, outlet was sold out


class SimulationRequest(BaseModel):
    """Request schema for a historic simulation run."""

    customer_id: str
    name: str | None = None
    description: str | None = None
    simulation_from: date
    simulation_to: date
    simulation_type: int = 1                # 1=prediction strategy, 3=same draw, 4=same sale
    delay: int = 14                         # days before chunk start to cut off history
    use_financials: bool = True             # include per-outlet weekday cost/profit covariates
    use_pad: bool = True                    # include pad event date covariates
    engine: str | None = None              # engine slug; falls back to customer → system config
    outlet_ids: list[str] | None = None    # None = all active outlets for customer
    outlet_group_id: str | None = None     # filter to a specific outlet group
    batch_size: int = 32                   # outlets per forward pass (increase for GPU, decrease if OOM)
    prediction_strategy_id: str | None = None  # FK to prediction_strategies; its columns are used as defaults
    increase_total_by: int | None = None   # extra copies to distribute greedily per date (delivered scenario only)
    increase_total_by_pct: float | None = None  # extra copies as % of total base delivered per date
    increase_outlets_by: int | None = None   # flat copies added to every outlet before delivery constraints
    increase_outlets_by_pct: float | None = None  # % of each outlet's base added before delivery constraints
    fixed_total_delivery: int | None = None  # distribute exactly this many copies per date via greedy heap (bypasses base + delivery constraints)
    total_return_pct: float | None = None    # target overall return % across all outlets; profit-optimal per-outlet allocation via Lagrange multiplier
    target_return_pct: float | None = None   # uniform per-outlet return target: deliver at the (100-R)th demand percentile per outlet
    outlet_return_percentage: dict[str, float] | None = None  # per-outlet target return %; overrides target_return_pct for matched outlets
    ignore_fixed: bool = False       # ignore outlet delivery fixed constraint
    ignore_minimum: bool = False     # ignore outlet delivery minimum constraint
    ignore_maximum: bool = False     # ignore outlet delivery maximum constraint
    worker: str | None = None        # route to a specific worker queue; None = any available


class SimulationDayResult(BaseModel):
    """Result for a single outlet on a single predicted day.

    Each day carries two parallel classifications:
    - Baseline: uses `predicted_draw` (point forecast) as the recommendation.
    - Economic optimal: uses `economic_optimal` (Newsvendor-adjusted draw) when available.
    """

    date: date
    weekday: int                         # 1=Monday, 7=Sunday

    # --- Baseline (point forecast) ---
    predicted_draw: float
    group: SimulationGroup | None        # None when no actual data available
    profit_impact: float | None          # financial impact (None for group 4)
    potential_profit: float | None       # group 4 upper-bound estimate

    # --- Economic optimal (Newsvendor-adjusted) ---
    economic_optimal: float | None       # None when financials unavailable
    eco_group: SimulationGroup | None = None
    eco_profit_impact: float | None = None
    eco_potential_profit: float | None = None

    # --- Actuals ---
    actual_draw: float | None            # what was actually delivered
    actual_sale: float | None            # what was actually sold


class OutletSimulationResult(BaseModel):
    """Aggregated simulation results for a single outlet."""

    outlet_id: str
    days: list[SimulationDayResult]

    # Baseline aggregates
    total_profit_impact: float
    potential_additional_profit: float
    group_counts: dict[int, int]

    # Economic optimal aggregates (only days where economic_optimal was available)
    eco_total_profit_impact: float
    eco_potential_additional_profit: float
    eco_group_counts: dict[int, int]


class SimulationTaskStatus(BaseModel):
    """Status of an async simulation task."""

    task_id: str
    status: str           # pending / running / completed / failed
    progress: float = 0.0
    message: str | None = None
    result: "SimulationResponse | None" = None
    created_at: datetime
    completed_at: datetime | None = None


class SimulationResponse(BaseModel):
    """Response schema for a completed simulation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    simulation_from: date
    simulation_to: date
    delay: int
    engine: str
    actual_engine: str | None = None
    outlets: list[OutletSimulationResult]

    # Baseline aggregates
    total_profit_impact: float
    potential_additional_profit: float
    group_counts: dict[int, int]

    # Economic optimal aggregates
    eco_total_profit_impact: float
    eco_potential_additional_profit: float
    eco_group_counts: dict[int, int]

    created_at: datetime


# --- DB-backed simulation record schemas ---


class SimulationRecordCreate(BaseModel):
    """Fields required to create a Simulation DB record."""

    customer_id: str
    name: str
    description: str | None = None
    prediction_strategy_id: str | None = None
    outlet_ids: list[str] | None = None
    simulation_from: date | None = None
    simulation_to: date | None = None
    delay: int | None = None
    engine: str | None = None


class SimulationRecordResponse(BaseModel):
    """Full DB row response for a Simulation record."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    prediction_strategy_id: str | None
    name: str
    description: str | None
    started_at: datetime | None
    ended_at: datetime | None
    task_id: str | None
    outlet_ids: list[str] | None
    simulation_from: date | None
    simulation_to: date | None
    delay: int | None
    engine: str | None
    actual_engine: str | None = None

    # Delivered scenario
    d_total_delivered: float | None
    d_total_sold: float | None
    d_total_returned: float | None
    d_diff_delivered: float | None
    d_diff_return: float | None
    d_lost_sale: float | None
    d_more_sale: float | None
    d_g1: float | None
    d_g2: float | None
    d_g3: float | None
    d_g4: float | None

    # Prediction scenario
    p_total_delivered: float | None
    p_total_sold: float | None
    p_total_returned: float | None
    p_diff_delivered: float | None
    p_diff_return: float | None
    p_lost_sale: float | None
    p_more_sale: float | None
    p_g1: float | None
    p_g2: float | None
    p_g3: float | None
    p_g4: float | None

    # Economic optimal scenario
    eo_total_delivered: float | None
    eo_total_sold: float | None
    eo_total_returned: float | None
    eo_diff_delivered: float | None
    eo_diff_return: float | None
    eo_lost_sale: float | None
    eo_more_sale: float | None
    eo_g1: float | None
    eo_g2: float | None
    eo_g3: float | None
    eo_g4: float | None

    active: bool
    created_at: datetime
    updated_at: datetime


class CompletedSimulationResponse(BaseModel):
    """Flattened view of a simulation task row for the Completed Simulations list."""

    id: str                                   # task_record.id (stable row key)
    task_id: str | None = None
    simulation_id: str | None = None          # null for failure / revoked rows
    status: str                               # success / failure / revoked
    customer_id: str
    name: str | None = None
    description: str | None = None
    simulation_from: date | None = None
    simulation_to: date | None = None
    engine: str | None = None
    actual_engine: str | None = None
    engine_params: dict | None = None
    delay: int | None = None
    outlet_count: int = 0
    outlet_group_id: str | None = None
    outlet_group_name: str | None = None
    prediction_strategy_name: str | None = None
    error: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None
    # Actual (historical) totals
    actual_total_delivered: float | None = None
    actual_total_sale: float | None = None
    actual_total_returned: float | None = None
    # Summary stats (null for non-success rows)
    d_total_delivered: float | None = None
    d_total_sold: float | None = None
    d_total_returned: float | None = None
    d_diff_delivered: float | None = None
    d_diff_return: float | None = None
    d_lost_sale: float | None = None
    d_more_sale: float | None = None
    d_g1: float | None = None
    d_g2: float | None = None
    d_g3: float | None = None
    d_g4: float | None = None
    p_total_delivered: float | None = None
    p_total_sold: float | None = None
    p_total_returned: float | None = None
    p_diff_delivered: float | None = None
    p_diff_return: float | None = None
    p_lost_sale: float | None = None
    p_more_sale: float | None = None
    p_g1: float | None = None
    p_g2: float | None = None
    p_g3: float | None = None
    p_g4: float | None = None
    eo_total_delivered: float | None = None
    eo_total_sold: float | None = None
    eo_total_returned: float | None = None
    eo_diff_delivered: float | None = None
    eo_diff_return: float | None = None
    eo_lost_sale: float | None = None
    eo_more_sale: float | None = None
    eo_g1: float | None = None
    eo_g2: float | None = None
    eo_g3: float | None = None
    eo_g4: float | None = None


class CompletedSimulationListResponse(BaseModel):
    items: list[CompletedSimulationResponse]
    total: int


class SimulationDateResponse(BaseModel):
    """DB row response for a SimulationDate record."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    simulation_id: str
    prediction_id: str
    active: bool
    created_at: datetime
    updated_at: datetime


class ZeroShotResponse(BaseModel):
    """Zero-shot accuracy counts for a simulation."""

    zero_shot: int
    zero_shot_plus_1: int
    zero_shot_minus_1: int
    zero_shot_plus_2: int
    zero_shot_minus_2: int
    zero_shot_plus_mul: int
    zero_shot_minus_mul: int
    no_actual_data: int
    total: int


class ModelFitOutlet(BaseModel):
    id: str
    name: str


class ModelFitDataPoint(BaseModel):
    date: date
    actual_sale: float | None
    delivered: float | None
    eo: float | None
    predicted: float | None
    lower_bound: float | None
    upper_bound: float | None
    sim_delivered: float | None = None
    sim_sold: float | None = None
    sim_returned: float | None = None
    sim_profit: float | None = None
    actual_delivered: float | None = None
    actual_sold: float | None = None
    actual_returned: float | None = None
    actual_profit: float | None = None


class ModelFitResponse(BaseModel):
    outlets: list[ModelFitOutlet]
    data: list[ModelFitDataPoint]


class AccuracyStatsResponse(BaseModel):
    """Statistical accuracy metrics for a simulation."""

    mae: float                        # Mean Absolute Error
    bias: float                       # Mean Error (positive = over-prediction)
    rmse: float                       # Root Mean Squared Error
    mape: float | None                # Mean Absolute Percentage Error (None if actuals contain zeros)
    r_squared: float | None           # Coefficient of determination
    count: int                        # Number of data points used


class FilteredOverviewResponse(BaseModel):
    """Aggregated overview stats for a filtered (e.g. weekday) subset of simulation dates."""

    total_delivered: float | None
    total_sold: float | None
    total_returned: float | None
    actual_total_delivered: float | None = None
    actual_total_sale: float | None = None
    actual_total_returned: float | None = None
    diff_delivered: float | None = None
    lost_sale: float | None = None
    diff_return: float | None = None
    more_sale: float | None = None
    g1: float | None = None
    g2: float | None = None
    g3: float | None = None
    g4: float | None = None
    sold_out_pct: float | None = None
    actual_sold_out_pct: float | None = None
    default_cost: float | None = None
    default_profit: float | None = None


class DataDumpRow(BaseModel):
    """Single prediction-outlet row for the data dump view."""

    outlet_id: str
    outlet_name: str
    date: date
    scenario_delivery: float | None
    scenario_sold: float | None
    scenario_returned: float | None
    actual_delivered: float | None
    actual_sold: float | None
    actual_returned: float | None
    q10: float | None = None
    q20: float | None = None
    q30: float | None = None
    q40: float | None = None
    q50: float | None = None
    q60: float | None = None
    q70: float | None = None
    q80: float | None = None
    q90: float | None = None
    g1: float | None = None
    g2: float | None = None
    g3: float | None = None
    g4: float | None = None
    g4_extra_sales: float | None = None
    g4_profit_unit: float | None = None
    g4_unit_probs: list[tuple[int, float]] | None = None
    cv: float | None = None
    eo: float | None = None


class DataDumpResponse(BaseModel):
    """Paginated prediction-outlet rows for a simulation."""

    rows: list[DataDumpRow]
    total_count: int
