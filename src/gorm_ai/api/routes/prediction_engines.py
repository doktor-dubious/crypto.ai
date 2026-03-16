"""Prediction engine API routes."""

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import PredictionEngineParameterServiceDep, PredictionEngineServiceDep
from gorm_ai.schemas.prediction import (
    PredictionEngineCreate,
    PredictionEngineParameterCreate,
    PredictionEngineParameterResponse,
    PredictionEngineResponse,
    PredictionEngineUpdate,
)

router = APIRouter()


@router.get("", response_model=list[PredictionEngineResponse])
async def list_prediction_engines(
    service: PredictionEngineServiceDep,
) -> list[PredictionEngineResponse]:
    """List all prediction engines."""
    engines = await service.list_all()
    return [PredictionEngineResponse.model_validate(e) for e in engines]


@router.post("", response_model=PredictionEngineResponse, status_code=201)
async def create_prediction_engine(
    data: PredictionEngineCreate,
    service: PredictionEngineServiceDep,
) -> PredictionEngineResponse:
    """Create a new prediction engine."""
    engine = await service.create(data)
    return PredictionEngineResponse.model_validate(engine)


@router.get("/{engine_id}", response_model=PredictionEngineResponse)
async def get_prediction_engine(
    engine_id: str,
    service: PredictionEngineServiceDep,
) -> PredictionEngineResponse:
    """Get a prediction engine by ID."""
    engine = await service.get(engine_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Prediction engine not found")
    return PredictionEngineResponse.model_validate(engine)


@router.patch("/{engine_id}", response_model=PredictionEngineResponse)
async def update_prediction_engine(
    engine_id: str,
    data: PredictionEngineUpdate,
    service: PredictionEngineServiceDep,
) -> PredictionEngineResponse:
    """Update a prediction engine."""
    engine = await service.update(engine_id, data)
    if not engine:
        raise HTTPException(status_code=404, detail="Prediction engine not found")
    return PredictionEngineResponse.model_validate(engine)


@router.delete("/{engine_id}", status_code=204)
async def delete_prediction_engine(
    engine_id: str,
    service: PredictionEngineServiceDep,
) -> None:
    """Soft-delete a prediction engine."""
    if not await service.delete(engine_id):
        raise HTTPException(status_code=404, detail="Prediction engine not found")


# ── Parameters ────────────────────────────────────────────────────────────────


@router.get("/{engine_id}/parameters", response_model=list[PredictionEngineParameterResponse])
async def list_engine_parameters(
    engine_id: str,
    service: PredictionEngineParameterServiceDep,
) -> list[PredictionEngineParameterResponse]:
    """List parameters for a prediction engine."""
    params = await service.list_by_engine(engine_id)
    return [PredictionEngineParameterResponse.model_validate(p) for p in params]


@router.post(
    "/{engine_id}/parameters",
    response_model=PredictionEngineParameterResponse,
    status_code=201,
)
async def create_engine_parameter(
    engine_id: str,
    data: PredictionEngineParameterCreate,
    service: PredictionEngineParameterServiceDep,
) -> PredictionEngineParameterResponse:
    """Add a parameter to a prediction engine."""
    param = await service.create(engine_id, data)
    return PredictionEngineParameterResponse.model_validate(param)


@router.post(
    "/parameters/{param_id}/toggle-selected",
    response_model=list[PredictionEngineParameterResponse],
)
async def toggle_parameter_selected(
    param_id: str,
    service: PredictionEngineParameterServiceDep,
) -> list[PredictionEngineParameterResponse]:
    """Toggle selection of a parameter (deselects others in the same group)."""
    param = await service.toggle_selected(param_id)
    if not param:
        raise HTTPException(status_code=404, detail="Parameter not found")
    # Return updated full list for the engine
    params = await service.list_by_engine(param.prediction_engine_id)
    return [
        PredictionEngineParameterResponse.model_validate(p)
        for p in params
    ]


@router.delete("/parameters/{param_id}", status_code=204)
async def delete_engine_parameter(
    param_id: str,
    service: PredictionEngineParameterServiceDep,
) -> None:
    """Soft-delete a prediction engine parameter."""
    if not await service.delete(param_id):
        raise HTTPException(status_code=404, detail="Parameter not found")
