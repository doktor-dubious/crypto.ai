"""System configuration Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ConfigurationUpdate(BaseModel):
    """Schema for updating system configuration."""

    peak_period: bool | None = None
    minimum_delivery: int | None = None
    price_per_unit: float | None = None
    cost_per_unit: float | None = None
    profit_per_unit: float | None = None
    eo_to_delivery_rounding: int | None = None
    prediction_engine_id: str | None = None
    weekday_correction_mon: bool | None = None
    weekday_correction_tue: bool | None = None
    weekday_correction_wed: bool | None = None
    weekday_correction_thu: bool | None = None
    weekday_correction_fri: bool | None = None
    weekday_correction_sat: bool | None = None
    weekday_correction_sun: bool | None = None
    weekday_only_mon: bool | None = None
    weekday_only_tue: bool | None = None
    weekday_only_wed: bool | None = None
    weekday_only_thu: bool | None = None
    weekday_only_fri: bool | None = None
    weekday_only_sat: bool | None = None
    weekday_only_sun: bool | None = None
    weekday_profile_correction: bool | None = None
    weekday_profile_correction_strength: float | None = None
    weekday_profile_correction_threshold: float | None = None
    weekday_profile_correction_method: int | None = None
    covariate_handling: str | None = None
    variation_adjustment: bool | None = None
    variation_history_days: int | None = None
    pad_baseline_window_days: int | None = None
    pad_history_days: int | None = None
    eo_methodology: int | None = None
    eo_extrapolation: int | None = None
    fallback_engine: bool | None = None
    open_monday: bool | None = None
    open_tuesday: bool | None = None
    open_wednesday: bool | None = None
    open_thursday: bool | None = None
    open_friday: bool | None = None
    open_saturday: bool | None = None
    open_sunday: bool | None = None
    simultaneous_tasks: int | None = None
    periodic_check_workers: int | None = None
    auto_restart_workers: bool | None = None
    finetuned_model_path: str | None = None
    finetune_sync_every: int | None = None
    insights_hidden_prompt: str | None = None
    insight_model_id: str | None = None
    insight_submodel_id: str | None = None


class ConfigurationResponse(BaseModel):
    """Schema for system configuration response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    active: bool
    created_at: datetime
    updated_at: datetime
    peak_period: bool
    minimum_delivery: int
    price_per_unit: float | None = None
    cost_per_unit: float | None = None
    profit_per_unit: float | None = None
    eo_to_delivery_rounding: int = 1
    prediction_engine_id: str | None = None
    weekday_correction_mon: bool = True
    weekday_correction_tue: bool = True
    weekday_correction_wed: bool = True
    weekday_correction_thu: bool = True
    weekday_correction_fri: bool = True
    weekday_correction_sat: bool = True
    weekday_correction_sun: bool = True
    weekday_only_mon: bool = False
    weekday_only_tue: bool = False
    weekday_only_wed: bool = False
    weekday_only_thu: bool = False
    weekday_only_fri: bool = False
    weekday_only_sat: bool = False
    weekday_only_sun: bool = False
    weekday_profile_correction: bool = False
    weekday_profile_correction_strength: float = 1.0
    weekday_profile_correction_threshold: float = 0.0
    weekday_profile_correction_method: int = 1
    covariate_handling: str = "external"
    variation_adjustment: bool = False
    variation_history_days: int = 365
    pad_baseline_window_days: int = 56
    pad_history_days: int = 730
    eo_methodology: int = 1
    eo_extrapolation: int = 3
    fallback_engine: bool = False
    open_monday: bool = True
    open_tuesday: bool = True
    open_wednesday: bool = True
    open_thursday: bool = True
    open_friday: bool = True
    open_saturday: bool = True
    open_sunday: bool = True
    simultaneous_tasks: int = 1
    periodic_check_workers: int = 2
    auto_restart_workers: bool = True
    finetuned_model_path: str = "models/timesfm_finetuned"
    finetune_sync_every: int = 5
    insights_hidden_prompt: str | None = None
    insight_model_id: str | None = None
    insight_submodel_id: str | None = None
