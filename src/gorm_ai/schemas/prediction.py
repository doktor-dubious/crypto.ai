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
    outlet_ids: list[str] | None = None       # None = all active outlets for customer
    outlet_group_id: str | None = None
    prediction_from: date
    prediction_to: date
    delay: int = 0                            # days to subtract from prediction_from when cutting off historical data
    use_financials: bool = True               # include per-outlet weekday cost/profit covariates
    use_pad: bool = True                      # include pad event date covariates
    engine: PredictionEngine | None = None    # falls back to customer/global config then STATISTICAL
    engine_params: dict | None = None


class PredictionResult(BaseModel):
    """Schema for a single prediction result."""

    date: date
    predicted_value: float
    lower_bound: float | None = None
    upper_bound: float | None = None
    confidence: float | None = None
    economic_optimal: float | None = None  # Newsvendor-optimal draw based on profit/cost margin


class OutletPrediction(BaseModel):
    """Prediction results for a single outlet."""

    outlet_id: str
    results: list[PredictionResult]


class PredictionResponse(BaseModel):
    """Schema for prediction response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    engine: PredictionEngine
    horizon: int
    outlets: list[OutletPrediction]
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
