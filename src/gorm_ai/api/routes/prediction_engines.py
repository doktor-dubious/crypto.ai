"""Prediction engine API routes."""

from fastapi import APIRouter

from gorm_ai.api.deps import DbSession
from gorm_ai.schemas.prediction import PredictionEngineResponse
from gorm_ai.services.prediction_engine import PredictionEngineService

router = APIRouter()


@router.get("", response_model=list[PredictionEngineResponse])
async def list_prediction_engines(session: DbSession) -> list[PredictionEngineResponse]:
    """List all prediction engines."""
    engines = await PredictionEngineService(session).list_all()
    return [PredictionEngineResponse.model_validate(e) for e in engines]
