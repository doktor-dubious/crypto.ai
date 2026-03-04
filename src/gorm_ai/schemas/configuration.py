"""System configuration Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ConfigurationUpdate(BaseModel):
    """Schema for updating system configuration."""

    peak_period: bool | None = None
    minimum_delivery: int | None = None
    cost_per_unit: float | None = None
    profit_per_unit: float | None = None
    prediction_engine_id: str | None = None


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
    prediction_engine_id: str | None = None
