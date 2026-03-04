"""Sales Pydantic schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class SalesBase(BaseModel):
    """Base schema for sales data."""

    date: date
    sold: int = 0
    delivered: int | None = None
    scan_sold: int | None = None
    net_sold: int | None = None


class SalesCreate(SalesBase):
    """Schema for creating a sales record."""

    customer_id: str
    outlet_id: str


class SalesUpdate(BaseModel):
    """Schema for updating a sales record."""

    sold: int | None = None
    delivered: int | None = None
    scan_sold: int | None = None
    net_sold: int | None = None
    active: bool | None = None


class SalesResponse(SalesBase):
    """Schema for sales response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    outlet_id: str
    active: bool
    created_at: datetime
    updated_at: datetime


class SalesBulkImport(BaseModel):
    """Schema for bulk importing sales records."""

    records: list[SalesCreate]


class SalesQuery(BaseModel):
    """Schema for querying sales data."""

    customer_id: str | None = None
    outlet_id: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    limit: int = 100
    offset: int = 0
