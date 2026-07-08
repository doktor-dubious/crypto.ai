"""Fine-tune Pydantic schemas."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class FineTuneCreate(BaseModel):
    customer_id: str
    name: str
    description: str | None = None
    prediction_engine_id: str
    outlet_group_id: str | None = None
    finetune_from: date | None = None
    finetune_to: date | None = None
    worker: str | None = None


class FineTuneResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str | None
    name: str
    description: str | None
    started_at: datetime | None
    ended_at: datetime | None
    end_condition: str | None
    outlet_group_id: str | None
    outlet_group_name: str | None = None
    coin_id: str | None = None
    coin_symbol: str | None = None
    quote_asset: str | None = None
    interval: str | None = None
    finetune_from: date | None
    finetune_to: date | None
    finetuned_outlets: int
    pathological_outlets: int
    worker_name: str | None
    prediction_engine_id: str | None
    engine_name: str | None = None
    task_id: str | None
    active: bool
    created_at: datetime
    updated_at: datetime


class FineTuneListResponse(BaseModel):
    items: list[FineTuneResponse]
    total: int
