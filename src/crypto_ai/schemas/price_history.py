"""Price history Pydantic schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class PriceHistoryCreate(BaseModel):
    """Schema for creating a price history entry."""

    customer_id: str
    name: str
    description: str | None = None
    effective_date: date
    weekdays: list[int]  # 1=Monday, 7=Sunday — creates one row per weekday
    price_per_unit: float | None = None
    cost_per_unit: float | None = None
    profit_per_unit: float | None = None


class PriceHistoryUpdate(BaseModel):
    """Schema for updating a price history entry."""

    name: str | None = None
    description: str | None = None
    effective_date: date | None = None
    weekday: int | None = None
    price_per_unit: float | None = None
    cost_per_unit: float | None = None
    profit_per_unit: float | None = None
    active: bool | None = None


class PriceHistoryResponse(BaseModel):
    """Schema for price history response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    name: str
    description: str | None
    effective_date: date
    weekday: int
    price_per_unit: float | None
    cost_per_unit: float | None
    profit_per_unit: float | None
    active: bool
    created_at: datetime
    updated_at: datetime
