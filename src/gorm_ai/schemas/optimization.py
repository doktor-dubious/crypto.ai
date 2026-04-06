"""Optimization settings Pydantic schemas."""

from datetime import date

from pydantic import BaseModel


class OptimizeSettingsRequest(BaseModel):
    """Request schema for finding optimal customer settings via simulation grid search."""

    customer_id: str
    name: str | None = None  # user-provided name, defaults to "Optimization {date}"
    # Which settings to optimize (all False by default)
    optimize_variation_adjustment: bool = False      # True/False -> 2 options
    optimize_eo_methodology: bool = False            # 1,2 -> 2 options
    optimize_eo_extrapolation: bool = False          # 1,2,3,4 -> 4 options
    optimize_covariate_handling: bool = False         # none,native,external -> 3 options
    optimize_covariate_types: bool = False             # 2^3=8 combos of weekday/price/PAD
    optimize_weekday_profile_correction: bool = False  # True/False -> 2 options
    # Range parameters — generate evenly spaced values between from/to
    optimize_history_window: bool = False
    history_window_from: int = 365
    history_window_to: int = 730
    history_window_iterations: int = 4
    optimize_correction_strength: bool = False
    correction_strength_from: float = 1.0
    correction_strength_to: float = 0.0
    correction_strength_iterations: int = 4
    optimize_correction_threshold: bool = False
    correction_threshold_from: float = 0.0
    correction_threshold_to: float = 1.0
    correction_threshold_iterations: int = 4
    # Simulation date range (preferred) or legacy day count
    simulation_from: date | None = None
    simulation_to: date | None = None
    simulation_days: int = 180  # fallback when dates are not provided
    delay: int = 1
    # Optional: override the prediction engine used in simulations
    prediction_engine_id: str | None = None
    # Optional: use a specific prediction strategy (includes engine + parameters)
    prediction_strategy_id: str | None = None
    # Optional: restrict simulation to outlets in a specific group
    outlet_group_id: str | None = None
    # Optional: route to a specific worker queue
    worker: str | None = None


class OptimizeSettingsStatus(BaseModel):
    """Status of an async optimization task."""

    task_id: str
    status: str
    progress: int = 0
    progress_message: str | None = None
    result: dict | None = None


class OptimizationResult(BaseModel):
    """Result of the optimization grid search."""

    best_combination: dict  # the winning settings
    best_score: float       # profitability score
    all_results: list[dict]  # all combos with scores, sorted best -> worst
    total_simulations: int
    completed_simulations: int


class OptimizationRunResponse(BaseModel):
    """Response schema for a persisted optimization run."""

    id: str
    customer_id: str
    name: str
    status: str
    optimize_variation_adjustment: bool
    optimize_eo_methodology: bool
    optimize_eo_extrapolation: bool
    optimize_covariate_handling: bool
    optimize_covariate_types: bool = False
    optimize_weekday_profile_correction: bool
    simulation_days: int
    delay: int
    prediction_engine_id: str | None = None
    engine_name: str | None = None
    outlet_group_id: str | None = None
    simulation_from: str | None = None
    simulation_to: str | None = None
    total_combinations: int
    completed_combinations: int
    best_combination: dict | None = None
    best_score: float | None = None
    results: list[dict] | None = None
    diagnostics: dict | None = None
    created_at: str
    completed_at: str | None = None


class ApplySettingsRequest(BaseModel):
    """Request to apply optimization result settings to a customer configuration."""

    variation_adjustment: bool | None = None
    eo_methodology: int | None = None
    eo_extrapolation: int | None = None
    covariate_handling: str | None = None
    weekday_profile_correction: bool | None = None
    variation_history_days: int | None = None
    weekday_profile_correction_strength: float | None = None
    weekday_profile_correction_threshold: float | None = None
