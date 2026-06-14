"""Prediction adjustment API routes."""

from fastapi import APIRouter, HTTPException

from crypto_ai.api.deps import PredictionAdjustmentServiceDep
from crypto_ai.schemas.prediction_adjustment import (
    PredictionAdjustmentCreate,
    PredictionAdjustmentResponse,
    PredictionAdjustmentUpdate,
)

router = APIRouter()


@router.get("", response_model=list[PredictionAdjustmentResponse])
async def list_prediction_adjustments(
    customer_id: str,
    service: PredictionAdjustmentServiceDep,
) -> list[PredictionAdjustmentResponse]:
    """List all prediction adjustments for a customer."""
    adjustments = await service.get_by_customer(customer_id)
    return [PredictionAdjustmentResponse.model_validate(a) for a in adjustments]


@router.post("", response_model=PredictionAdjustmentResponse, status_code=201)
async def create_prediction_adjustment(
    data: PredictionAdjustmentCreate,
    service: PredictionAdjustmentServiceDep,
) -> PredictionAdjustmentResponse:
    """Create a new prediction adjustment."""
    adjustment = await service.create(data)
    return PredictionAdjustmentResponse.model_validate(adjustment)


@router.get("/{adjustment_id}", response_model=PredictionAdjustmentResponse)
async def get_prediction_adjustment(
    adjustment_id: str,
    service: PredictionAdjustmentServiceDep,
) -> PredictionAdjustmentResponse:
    """Get a prediction adjustment by ID."""
    adjustment = await service.get(adjustment_id)
    if not adjustment:
        raise HTTPException(status_code=404, detail="Prediction adjustment not found")
    return PredictionAdjustmentResponse.model_validate(adjustment)


@router.patch("/{adjustment_id}", response_model=PredictionAdjustmentResponse)
async def update_prediction_adjustment(
    adjustment_id: str,
    data: PredictionAdjustmentUpdate,
    service: PredictionAdjustmentServiceDep,
) -> PredictionAdjustmentResponse:
    """Update a prediction adjustment."""
    adjustment = await service.update(adjustment_id, data)
    if not adjustment:
        raise HTTPException(status_code=404, detail="Prediction adjustment not found")
    return PredictionAdjustmentResponse.model_validate(adjustment)


@router.delete("/{adjustment_id}", status_code=204)
async def delete_prediction_adjustment(
    adjustment_id: str,
    service: PredictionAdjustmentServiceDep,
) -> None:
    """Delete a prediction adjustment (soft delete by default)."""
    deleted = await service.delete(adjustment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Prediction adjustment not found")
