"""Coin group schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CoinGroupBase(BaseModel):
    """Base coin-group fields."""

    name: str
    description: str | None = None
    notes: str | None = None


class CoinGroupCreate(CoinGroupBase):
    """Create coin-group request."""

    pass


class CoinGroupUpdate(BaseModel):
    """Update coin-group request."""

    name: str | None = None
    description: str | None = None
    notes: str | None = None


class CoinGroupResponse(CoinGroupBase):
    """Coin-group response, including its member coin ids."""

    id: str
    # Reserved-group identifier ("favorites") or None for ordinary groups.
    slug: str | None = None
    active: bool
    member_coin_ids: list[str] = []
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
