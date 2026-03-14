"""Currency Pydantic schemas."""

from pydantic import BaseModel, ConfigDict


class CurrencyResponse(BaseModel):
    """Schema for currency response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    iso_4217: str
    symbol: str
    name: str
