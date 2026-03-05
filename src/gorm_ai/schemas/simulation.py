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
