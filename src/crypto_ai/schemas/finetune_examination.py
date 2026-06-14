"""Finetune examination Pydantic schemas."""

from pydantic import BaseModel


class FinetuneExaminationCreate(BaseModel):
    """Request schema for creating a finetune examination."""

    customer_id: str
    name: str
    description: str | None = None
    simulation_from: str  # ISO date
    simulation_to: str
    delay: int = 1
    outlet_group_id: str | None = None
    prediction_strategy_id: str | None = None
    base_engine: str = "timesfm"
    finetuned_engine: str = "timesfm_finetuned"
    finetuned_model: str | None = None
    worker: str | None = None


class FinetuneExaminationResponse(BaseModel):
    """Response schema for a finetune examination."""

    id: str
    customer_id: str
    name: str
    description: str | None
    simulation_from: str | None
    simulation_to: str | None
    delay: int | None
    outlet_group_id: str | None
    prediction_strategy_id: str | None
    base_engine: str | None
    finetuned_engine: str | None
    finetuned_model: str | None
    base_simulation_id: str | None
    finetuned_simulation_id: str | None
    status: str
    error: str | None
    started_at: str | None
    completed_at: str | None
    task_id: str | None
    base_stats: dict | None
    finetuned_stats: dict | None
    base_zero_shot: dict | None
    finetuned_zero_shot: dict | None
    base_overview: dict | None
    finetuned_overview: dict | None
    conclusion: str | None
    active: bool
    created_at: str
    updated_at: str


class FinetuneExaminationListResponse(BaseModel):
    """Paginated list of finetune examinations."""

    items: list[FinetuneExaminationResponse]
    total: int
