"""Configuration covariate Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ConfigurationCovariateResponse(BaseModel):
    """Response schema for a configuration covariate."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str | None
    name: str
    description: str | None
    type: int
    active: bool
    created_at: datetime
    updated_at: datetime


class ConfigurationCovariateUpdate(BaseModel):
    """Update schema — toggle active on/off."""

    active: bool
