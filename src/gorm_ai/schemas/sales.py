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


class AggregatedSalesRequest(BaseModel):
    """Request for aggregated sales across multiple outlets."""

    customer_id: str
    outlet_ids: list[str]
    start_date: date
    end_date: date


class AggregatedSalesDataPoint(BaseModel):
    """A single date's aggregated sales data."""

    date: date
    delivered: int | None = None
    sold: int = 0
    returned: int | None = None


class AggregatedSalesResponse(BaseModel):
    """Response for aggregated sales across outlets."""

    data: list[AggregatedSalesDataPoint]
    outlet_count: int


class EfficiencyDataPoint(BaseModel):
    """A single date's efficiency metrics."""

    date: date
    return_pct: float | None = None
    sold_out_pct: float | None = None
    delivered: int | None = None
    sold: int = 0
    returned: int | None = None
    outlet_count: int = 0
    sold_out_count: int = 0


class EfficiencyResponse(BaseModel):
    """Response for efficiency metrics across outlets."""

    data: list[EfficiencyDataPoint]
    outlet_count: int


class FinancialsRequest(BaseModel):
    """Request for financial statistics."""

    customer_id: str
    outlet_ids: list[str]
    start_date: date
    end_date: date


class FinancialsPerDateDataPoint(BaseModel):
    """Financial metrics aggregated per date."""

    date: date
    revenue: float
    cost: float
    profit: float
    avg_profit: float
    outlet_count: int


class FinancialsPerDateResponse(BaseModel):
    """Response for per-date financial statistics."""

    data: list[FinancialsPerDateDataPoint]
    outlet_count: int


class FinancialsPerOutletDataPoint(BaseModel):
    """Financial metrics per outlet over the period."""

    outlet_id: str
    ext_id: str
    name: str
    revenue: float
    cost: float
    profit: float
    avg_profit: float
    days: int


class FinancialsPerOutletResponse(BaseModel):
    """Response for per-outlet financial statistics."""

    data: list[FinancialsPerOutletDataPoint]
