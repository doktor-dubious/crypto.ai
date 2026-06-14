"""Coin schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CoinBase(BaseModel):
    """Base coin fields."""

    symbol: str
    name: str
    description: str | None = None
    type: str | None = None


class CoinCreate(CoinBase):
    """Create coin request."""

    pass


class CoinUpdate(BaseModel):
    """Update coin request."""

    symbol: str | None = None
    name: str | None = None
    description: str | None = None
    type: str | None = None


class CoinResponse(CoinBase):
    """Coin response."""

    id: str
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
