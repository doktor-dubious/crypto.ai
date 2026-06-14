"""Pad Pydantic schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class PadDateResponse(BaseModel):
    """Response schema for a single pad date."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    pad_id: str
    date: date
    active: bool
    created_at: datetime


class PadBase(BaseModel):
    """Base schema for pad data."""

    name: str
    historic_days: int = 0          # 0 = use all available history
    allow_negative: bool = True
    boost: float = 0.0              # fixed copy adjustment
    boost_pct: float = 0.0          # percentage adjustment


class PadCreate(PadBase):
    """Schema for creating a pad."""

    customer_id: str
    dates: list[date] = []


class PadUpdate(BaseModel):
    """Schema for updating a pad."""

    name: str | None = None
    historic_days: int | None = None
    allow_negative: bool | None = None
    boost: float | None = None
    boost_pct: float | None = None
    active: bool | None = None


class PadResponse(PadBase):
    """Response schema for a pad."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    active: bool
    dates: list[PadDateResponse]
    created_at: datetime
    updated_at: datetime


class PadDateAdd(BaseModel):
    """Schema for adding dates to a pad."""

    dates: list[date]
