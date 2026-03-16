"""Prediction engine parameter schemas."""

from pydantic import BaseModel, ConfigDict


class PredictionEngineParameterResponse(BaseModel):
    """Schema for prediction engine parameter response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    prediction_engine_id: str
    name: str
    value: str


class PredictionEngineParameterCreate(BaseModel):
    """Schema for creating a prediction engine parameter."""

    prediction_engine_id: str
    name: str
    value: str


class PredictionEngineParameterUpdate(BaseModel):
    """Schema for updating a prediction engine parameter."""

    name: str | None = None
    value: str | None = None
