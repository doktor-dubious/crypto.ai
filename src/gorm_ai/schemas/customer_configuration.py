"""Customer configuration Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CustomerConfigurationBase(BaseModel):
    """Base schema for customer configuration data."""

    peak_period: bool | None = None
    minimum_delivery: int | None = None
    cost_per_unit: float | None = None
    profit_per_unit: float | None = None
    eo_to_delivery_rounding: int | None = None
    prediction_engine_id: str | None = None
    group_id: str | None = None
    production_group_id: str | None = None
    currency_id: str | None = None
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
    insights_system_prompt: str | None = None
    insights_prediction_engine_id: str | None = None
    insights_prediction_strategy_id: str | None = None
    insights_worker: str | None = None
    insight_model_id: str | None = None
    insight_submodel_id: str | None = None


class CustomerConfigurationCreate(CustomerConfigurationBase):
    """Schema for creating customer configuration."""

    pass


class CustomerConfigurationUpdate(BaseModel):
    """Schema for updating customer configuration."""

    peak_period: bool | None = None
    minimum_delivery: int | None = None
    cost_per_unit: float | None = None
    profit_per_unit: float | None = None
    eo_to_delivery_rounding: int | None = None
    prediction_engine_id: str | None = None
    group_id: str | None = None
    production_group_id: str | None = None
    currency_id: str | None = None
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
    insights_system_prompt: str | None = None


class CustomerConfigurationResponse(CustomerConfigurationBase):
    """Schema for customer configuration response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    currency_symbol: str | None = None
    active: bool
    created_at: datetime
    updated_at: datetime
