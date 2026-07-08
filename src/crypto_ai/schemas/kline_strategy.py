"""Pydantic schemas for KlineStrategy (crypto-simulation presets) + parameters."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

# How the swing-signal series reach the model: no covariates, the engine's
# native model-side covariate API, or the engine-agnostic external trailing
# Ridge fitted on the walk-forward's own residual history.
CovariateMode = Literal["off", "native", "external"]


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
    # Bars per forecast step (1 = next bar; H>1 = non-overlapping H-bar trend).
    horizon: int = 1
    # Swing-signal covariates: off / native (TimesFM, Chronos-2) / external
    # (trailing-Ridge walk-forward adjustment, any engine).
    covariate_mode: CovariateMode = "off"
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
    horizon: int | None = None
    covariate_mode: CovariateMode | None = None
    starred: bool | None = None


class KlineStrategyResponse(KlineStrategyBase):
    id: str
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
