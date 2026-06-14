"""Prediction strategy API routes."""

from fastapi import APIRouter, HTTPException

from crypto_ai.api.deps import PredictionEngineParameterServiceDep, PredictionStrategyServiceDep
from crypto_ai.schemas.prediction import (
    PredictionEngineParameterCreate,
    PredictionEngineParameterResponse,
    PredictionStrategyCreate,
    PredictionStrategyResponse,
    PredictionStrategyUpdate,
)

router = APIRouter()


@router.get("", response_model=list[PredictionStrategyResponse])
async def list_prediction_strategies(
    customer_id: str,
    service: PredictionStrategyServiceDep,
) -> list[PredictionStrategyResponse]:
    """List all active prediction strategies for a customer."""
    strategies = await service.list_by_customer(customer_id)
    return [PredictionStrategyResponse.model_validate(s) for s in strategies]


@router.post("", response_model=PredictionStrategyResponse, status_code=201)
async def create_prediction_strategy(
    data: PredictionStrategyCreate,
    service: PredictionStrategyServiceDep,
) -> PredictionStrategyResponse:
    """Create a new prediction strategy."""
    strategy = await service.create(data)
    return PredictionStrategyResponse.model_validate(strategy)


@router.get("/{strategy_id}", response_model=PredictionStrategyResponse)
async def get_prediction_strategy(
    strategy_id: str,
    service: PredictionStrategyServiceDep,
) -> PredictionStrategyResponse:
    """Get a prediction strategy by ID."""
    strategy = await service.get(strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail="Prediction strategy not found")
    return PredictionStrategyResponse.model_validate(strategy)


@router.patch("/{strategy_id}", response_model=PredictionStrategyResponse)
async def update_prediction_strategy(
    strategy_id: str,
    data: PredictionStrategyUpdate,
    service: PredictionStrategyServiceDep,
) -> PredictionStrategyResponse:
    """Update a prediction strategy."""
    strategy = await service.update(strategy_id, data)
    if not strategy:
        raise HTTPException(status_code=404, detail="Prediction strategy not found")
    return PredictionStrategyResponse.model_validate(strategy)


@router.delete("/{strategy_id}", status_code=204)
async def delete_prediction_strategy(
    strategy_id: str,
    service: PredictionStrategyServiceDep,
) -> None:
    """Soft-delete a prediction strategy."""
    if not await service.delete(strategy_id):
        raise HTTPException(status_code=404, detail="Prediction strategy not found")


# ── Strategy Parameters ──────────────────────────────────────────────────────


@router.get(
    "/{strategy_id}/parameters",
    response_model=list[PredictionEngineParameterResponse],
)
async def list_strategy_parameters(
    strategy_id: str,
    service: PredictionEngineParameterServiceDep,
) -> list[PredictionEngineParameterResponse]:
    """List parameters scoped to a prediction strategy."""
    params = await service.list_by_strategy(strategy_id)
    return [PredictionEngineParameterResponse.model_validate(p) for p in params]


@router.post(
    "/{strategy_id}/parameters",
    response_model=PredictionEngineParameterResponse,
    status_code=201,
)
async def create_strategy_parameter(
    strategy_id: str,
    data: PredictionEngineParameterCreate,
    param_service: PredictionEngineParameterServiceDep,
    strategy_service: PredictionStrategyServiceDep,
) -> PredictionEngineParameterResponse:
    """Add a parameter to a prediction strategy.

    The strategy must have a prediction_engine_id set so the parameter
    can be linked to the correct engine.
    """
    strategy = await strategy_service.get(strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail="Prediction strategy not found")
    if not strategy.prediction_engine_id:
        raise HTTPException(
            status_code=400,
            detail="Strategy has no engine assigned — set an engine first",
        )
    param = await param_service.create(
        engine_id=strategy.prediction_engine_id,
        data=data,
        strategy_id=strategy_id,
    )
    return PredictionEngineParameterResponse.model_validate(param)
