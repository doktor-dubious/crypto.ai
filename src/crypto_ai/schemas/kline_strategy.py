"""Pydantic schemas for KlineStrategy (crypto-simulation presets) + parameters."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


# ─── Parameters ──────────────────────────────────────────────────────────────


class KlineStrategyParameterBase(BaseModel):
    name: str
    value: str
    description: str | None = None
    selected: bool = True


class KlineStrategyParameterCreate(KlineStrategyParameterBase):
    pass


class KlineStrategyParameterUpdate(BaseModel):
    name: str | None = None
    value: str | None = None
    description: str | None = None
    selected: bool | None = None


class KlineStrategyParameterResponse(KlineStrategyParameterBase):
    id: str
    strategy_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ─── Strategy ────────────────────────────────────────────────────────────────


class KlineStrategyBase(BaseModel):
    name: str
    description: str | None = None
    simulation_strategy: str = "price"
    finetuned_model: str | None = None
    forecast_engine: str | None = None
    forecast_vol: bool = False
    starred: bool = False


class KlineStrategyCreate(KlineStrategyBase):
    pass


class KlineStrategyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    simulation_strategy: str | None = None
    finetuned_model: str | None = None
    forecast_engine: str | None = None
    forecast_vol: bool | None = None
    starred: bool | None = None


class KlineStrategyResponse(KlineStrategyBase):
    id: str
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
