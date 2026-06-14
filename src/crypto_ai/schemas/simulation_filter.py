"""SimulationFilter Pydantic schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class SimulationFilterCreate(BaseModel):
    """Schema for creating a simulation filter."""

    customer_id: str
    name: str
    description: str | None = None
    from_date: date
    to_date: date


class SimulationFilterUpdate(BaseModel):
    """Schema for updating a simulation filter."""

    name: str | None = None
    description: str | None = None
    from_date: date | None = None
    to_date: date | None = None


class SimulationFilterResponse(BaseModel):
    """Schema for simulation filter response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    name: str
    description: str | None
    from_date: date
    to_date: date
    active: bool
    created_at: datetime
    updated_at: datetime
