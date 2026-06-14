"""Financial date Pydantic schemas."""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class FinancialDateCreate(BaseModel):
    """Schema for creating a financial date."""

    customer_id: str
    name: str
    description: str | None = None
    date: date
    method: int = 0  # 0=copy, 1=fixed
    copy_from_weekday: int | None = None  # 1-7 (ISO weekday)
    cost_per_unit: float | None = None
    profit_per_unit: float | None = None
    outlet_group_id: str | None = None


class FinancialDateUpdate(BaseModel):
    """Schema for updating a financial date."""

    name: str | None = None
    description: str | None = None
    date: Optional[date] = None
    active: Optional[bool] = None


class FinancialDateResponse(BaseModel):
    """Schema for financial date response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    name: str
    description: str | None
    date: date
    method: int
    copy_from_weekday: int | None
    active: bool
    created_at: datetime
    updated_at: datetime
