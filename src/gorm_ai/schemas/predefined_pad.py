"""PredefinedPad Pydantic schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class PredefinedPadDateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    predefined_pad_id: str
    date: date
    active: bool
    created_at: datetime


class PredefinedPadBase(BaseModel):
    name: str
    description: str | None = None
    country: str | None = None
    allow_negative: bool = True


class PredefinedPadCreate(PredefinedPadBase):
    dates: list[date] = []


class PredefinedPadUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    country: str | None = None
    allow_negative: bool | None = None
    active: bool | None = None


class PredefinedPadResponse(PredefinedPadBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    active: bool
    dates: list[PredefinedPadDateResponse]
    created_at: datetime
    updated_at: datetime


class PredefinedPadDateAdd(BaseModel):
    dates: list[date]
