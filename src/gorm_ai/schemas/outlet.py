"""Outlet Pydantic schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class OutletInfoBase(BaseModel):
    """Base schema for outlet info."""

    key: str
    value: str | None = None


class OutletInfoCreate(OutletInfoBase):
    """Schema for creating outlet info."""

    pass


class OutletInfoResponse(OutletInfoBase):
    """Schema for outlet info response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    active: bool


class OutletDeliveryBase(BaseModel):
    """Base schema for outlet delivery."""

    weekday: int  # 1-7, Monday=1, Sunday=7
    fixed: float | None = None
    minimum: float | None = None
    maximum: float | None = None
    add: float | None = None
    add_pct: float | None = None


class OutletDeliveryCreate(OutletDeliveryBase):
    """Schema for creating outlet delivery."""

    pass


class OutletDeliveryResponse(OutletDeliveryBase):
    """Schema for outlet delivery response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    active: bool


class OutletBase(BaseModel):
    """Base schema for outlet data."""

    ext_id: str
    ext_id_2: int | None = None
    name: str
    description: str | None = None
    notes: str | None = None
    address: str | None = None
    zip: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    scan: bool = False
    season: bool = False
    sublets: bool = False


class OutletCreate(OutletBase):
    """Schema for creating an outlet."""

    customer_id: str
    info: list[OutletInfoCreate] | None = None
    deliveries: list[OutletDeliveryCreate] | None = None


class OutletUpdate(BaseModel):
    """Schema for updating an outlet."""

    ext_id: str | None = None
    ext_id_2: int | None = None
    name: str | None = None
    description: str | None = None
    notes: str | None = None
    address: str | None = None
    zip: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    scan: bool | None = None
    season: bool | None = None
    sublets: bool | None = None
    active: bool | None = None


class OutletResponse(OutletBase):
    """Schema for outlet response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    active: bool
    created_at: datetime
    updated_at: datetime
    info: list[OutletInfoResponse] = []
    deliveries: list[OutletDeliveryResponse] = []


class DeliveryAnalyticsWeekday(BaseModel):
    """Analytics for one weekday across all metrics."""

    weekday: int  # 1=Monday, 7=Sunday
    sold_history: list[int | None]       # last 8, index 0 = most recent
    delivered_history: list[int | None]
    returned_history: list[int | None]   # delivered - sold, null when delivered is null
    raw_prediction: float | None         # trimmed mean of last 4 sold values
    lower_bound: float | None
    upper_bound: float | None
    predicted: float | None
    economic_optimal: float | None
    delivered: float | None              # latest recommended delivery
    pad_effect: float | None = None      # avg(PAD predictions) - avg(non-PAD baseline)
    pad_effect_pct: float | None = None  # pad_effect as % of baseline
    cost_per_unit: float | None = None
    profit_per_unit: float | None = None
    fixed: float | None = None
    minimum: float | None = None
    maximum: float | None = None
    add: float | None = None
    add_pct: float | None = None


class DeliveryAnalyticsResponse(BaseModel):
    """Delivery analytics per weekday for an outlet."""

    outlet_id: str
    weekdays: list[DeliveryAnalyticsWeekday]  # up to 7, only weekdays with data
