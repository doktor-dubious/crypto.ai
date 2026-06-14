"""SalesFilter Pydantic schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class SalesFilterCreate(BaseModel):
    """Schema for creating a sales filter."""

    customer_id: str
    name: str
    description: str | None = None
    from_date: date
    to_date: date


class SalesFilterUpdate(BaseModel):
    """Schema for updating a sales filter."""

    name: str | None = None
    description: str | None = None
    from_date: date | None = None
    to_date: date | None = None


class SalesFilterResponse(BaseModel):
    """Schema for sales filter response."""

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
