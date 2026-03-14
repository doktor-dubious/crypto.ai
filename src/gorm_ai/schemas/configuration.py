"""System configuration Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ConfigurationUpdate(BaseModel):
    """Schema for updating system configuration."""

    peak_period: bool | None = None
    minimum_delivery: int | None = None
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
    simultaneous_tasks: int | None = None
    periodic_check_workers: int | None = None
    auto_restart_workers: bool | None = None


class ConfigurationResponse(BaseModel):
    """Schema for system configuration response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    active: bool
    created_at: datetime
    updated_at: datetime
    peak_period: bool
    minimum_delivery: int
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
    simultaneous_tasks: int = 1
    periodic_check_workers: int = 2
    auto_restart_workers: bool = True
