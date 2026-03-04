"""Customer Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CustomerBase(BaseModel):
    """Base schema for customer data."""

    type: int = 0
    name: str
    description: str | None = None
    notes: str | None = None


class CustomerCreate(CustomerBase):
    """Schema for creating a customer."""

    pass


class CustomerUpdate(BaseModel):
    """Schema for updating a customer."""

    type: int | None = None
    name: str | None = None
    description: str | None = None
    notes: str | None = None
    active: bool | None = None


class CustomerResponse(CustomerBase):
    """Schema for customer response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    active: bool
    created_at: datetime
    updated_at: datetime
