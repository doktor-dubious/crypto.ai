"""Customer configuration Pydantic schemas."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CustomerConfigurationBase(BaseModel):
    """Base schema for customer configuration data."""

    peak_period: bool | None = None
    minimum_delivery: int | None = None
    cost_per_unit: Decimal | None = None
    profit_per_unit: Decimal | None = None
    default_prediction_engine: str | None = None


class CustomerConfigurationCreate(CustomerConfigurationBase):
    """Schema for creating customer configuration."""

    pass


class CustomerConfigurationUpdate(BaseModel):
    """Schema for updating customer configuration."""

    peak_period: bool | None = None
    minimum_delivery: int | None = None
    cost_per_unit: Decimal | None = None
    profit_per_unit: Decimal | None = None
    default_prediction_engine: str | None = None


class CustomerConfigurationResponse(CustomerConfigurationBase):
    """Schema for customer configuration response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    active: bool
    created_at: datetime
    updated_at: datetime
