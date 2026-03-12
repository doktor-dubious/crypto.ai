"""Outlet group Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class OutletGroupBase(BaseModel):
    """Base schema for outlet group data."""

    name: str
    description: str | None = None


class OutletGroupCreate(OutletGroupBase):
    """Schema for creating an outlet group."""

    customer_id: str


class OutletGroupUpdate(BaseModel):
    """Schema for updating an outlet group."""

    name: str | None = None
    description: str | None = None
    active: bool | None = None


class OutletGroupResponse(OutletGroupBase):
    """Schema for outlet group response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    active: bool
    outlet_count: int = 0
    created_at: datetime
    updated_at: datetime


class OutletGroupMemberCreate(BaseModel):
    """Schema for adding an outlet to a group."""

    outlet_id: str
