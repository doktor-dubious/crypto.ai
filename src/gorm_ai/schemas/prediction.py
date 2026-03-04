"""Prediction Pydantic schemas."""

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class PredictionEngine(StrEnum):
    """Available prediction engines."""

    STATISTICAL = "statistical"
    TIMESFM = "timesfm"
    CUSTOM = "custom"


class TaskStatus(StrEnum):
    """Task status values."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class PredictionRequest(BaseModel):
    """Schema for requesting a prediction."""

    customer_id: str
    outlet_id: str | None = None
    prediction_from: date
    prediction_to: date
    engine: PredictionEngine | None = None  # falls back to customer/global config then STATISTICAL
    engine_params: dict | None = None


class PredictionResult(BaseModel):
    """Schema for a single prediction result."""

    date: date
    predicted_value: float
    lower_bound: float | None = None
    upper_bound: float | None = None
    confidence: float | None = None


class PredictionResponse(BaseModel):
    """Schema for prediction response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    outlet_id: str | None
    engine: PredictionEngine
    horizon: int
    results: list[PredictionResult]
    created_at: datetime


class PredictionTaskStatus(BaseModel):
    """Schema for prediction task status."""

    task_id: str
    status: TaskStatus
    progress: float = 0.0
    message: str | None = None
    result: PredictionResponse | None = None
    created_at: datetime
    completed_at: datetime | None = None
