"""Prediction strategy API routes."""

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import PredictionStrategyServiceDep
from gorm_ai.schemas.prediction import (
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
