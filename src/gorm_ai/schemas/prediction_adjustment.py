"""Prediction adjustment Pydantic schemas."""

from datetime import date, datetime
from enum import IntEnum
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AdjustmentType(IntEnum):
    """Prediction adjustment type enumeration."""

    PER_OUTLET_BY_NUMBER = 1
    PER_OUTLET_BY_PERCENTAGE = 2
    OVERALL_BY_NUMBER = 3
    OVERALL_BY_PERCENTAGE = 4


class PredictionAdjustmentBase(BaseModel):
    """Base schema for prediction adjustment data."""

    name: str
    date: date
    type: AdjustmentType
    value: float


class PredictionAdjustmentCreate(PredictionAdjustmentBase):
    """Schema for creating a prediction adjustment."""

    group_id: str


class PredictionAdjustmentUpdate(BaseModel):
    """Schema for updating a prediction adjustment."""

    name: Optional[str] = None
    date: Optional[date] = None
    type: Optional[AdjustmentType] = None
    value: Optional[float] = None
    active: Optional[bool] = None


class PredictionAdjustmentResponse(PredictionAdjustmentBase):
    """Schema for prediction adjustment response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    group_id: str
    active: bool
    created_at: datetime
    updated_at: datetime
