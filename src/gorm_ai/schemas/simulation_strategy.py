"""SimulationStrategy Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SimulationStrategyCreate(BaseModel):
    customer_id: str
    prediction_strategy_id: str | None = None
    type: int = 1
    delay: int = 14


class SimulationStrategyUpdate(BaseModel):
    prediction_strategy_id: str | None = None
    type: int | None = None
    delay: int | None = None


class SimulationStrategyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    prediction_strategy_id: str | None
    type: int
    delay: int
    active: bool
    created_at: datetime
    updated_at: datetime
