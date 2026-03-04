"""Draw adjustment Pydantic schemas."""

from datetime import date, datetime
from enum import IntEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AdjustmentType(IntEnum):
    """Draw adjustment type enumeration."""

    PER_OUTLET_BY_NUMBER = 1
    PER_OUTLET_BY_PERCENTAGE = 2
    OVERALL_BY_NUMBER = 3
    OVERALL_BY_PERCENTAGE = 4


class DrawAdjustmentBase(BaseModel):
    """Base schema for draw adjustment data."""

    name: str
    start_date: date
    end_date: date
    day_of_week: int = Field(ge=0, le=6, description="Day of week (0=Monday, 6=Sunday)")
    type: AdjustmentType
    value: float

    @field_validator("day_of_week")
    @classmethod
    def validate_day_of_week(cls, v: int) -> int:
        """Validate day_of_week is between 0 and 6."""
        if not 0 <= v <= 6:
            raise ValueError("day_of_week must be between 0 (Monday) and 6 (Sunday)")
        return v

    @field_validator("end_date")
    @classmethod
    def validate_date_range(cls, v: date, info) -> date:
        """Validate end_date is after start_date."""
        if "start_date" in info.data and v <= info.data["start_date"]:
            raise ValueError("end_date must be after start_date")
        return v


class DrawAdjustmentCreate(DrawAdjustmentBase):
    """Schema for creating a draw adjustment."""

    group_id: str


class DrawAdjustmentUpdate(BaseModel):
    """Schema for updating a draw adjustment."""

    name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    day_of_week: int | None = Field(None, ge=0, le=6)
    type: AdjustmentType | None = None
    value: float | None = None
    active: bool | None = None


class DrawAdjustmentResponse(DrawAdjustmentBase):
    """Schema for draw adjustment response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    group_id: str
    active: bool
    created_at: datetime
    updated_at: datetime
