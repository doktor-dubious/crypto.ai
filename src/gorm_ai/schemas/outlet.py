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

    weekday: int  # 0-6, Monday=0
    quantity: int = 0


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
