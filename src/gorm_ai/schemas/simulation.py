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
    simulation_from: date
    simulation_to: date
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

    # Delivered scenario
    d_total_delivered: int | None
    d_total_sold: int | None
    d_total_returned: int | None
    d_diff_delivered: int | None
    d_diff_return: int | None
    d_lost_sale: int | None
    d_more_sale: int | None
    d_g1: float | None
    d_g2: float | None
    d_g3: float | None
    d_g4: float | None

    # Prediction scenario
    p_total_delivered: float | None
    p_total_sold: float | None
    p_total_returned: float | None
    p_diff_delivered: int | None
    p_diff_return: int | None
    p_lost_sale: int | None
    p_more_sale: int | None
    p_g1: float | None
    p_g2: float | None
    p_g3: float | None
    p_g4: float | None

    # Economic optimal scenario
    eo_total_delivered: float | None
    eo_total_sold: float | None
    eo_total_returned: float | None
    eo_diff_delivered: int | None
    eo_diff_return: int | None
    eo_lost_sale: int | None
    eo_more_sale: int | None
    eo_g1: float | None
    eo_g2: float | None
    eo_g3: float | None
    eo_g4: float | None

    active: bool
    created_at: datetime
    updated_at: datetime


class SimulationDateResponse(BaseModel):
    """DB row response for a SimulationDate record."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    simulation_id: str
    prediction_id: str
    active: bool
    created_at: datetime
    updated_at: datetime
