"""Draw adjustment API routes."""

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import DrawAdjustmentServiceDep
from gorm_ai.schemas.draw_adjustment import (
    DrawAdjustmentCreate,
    DrawAdjustmentResponse,
    DrawAdjustmentUpdate,
)

router = APIRouter()


@router.post("", response_model=DrawAdjustmentResponse, status_code=201)
async def create_draw_adjustment(
    data: DrawAdjustmentCreate,
    service: DrawAdjustmentServiceDep,
) -> DrawAdjustmentResponse:
    """Create a new draw adjustment."""
    adjustment = await service.create(data)
    return DrawAdjustmentResponse.model_validate(adjustment)


@router.get("/{adjustment_id}", response_model=DrawAdjustmentResponse)
async def get_draw_adjustment(
    adjustment_id: str,
    service: DrawAdjustmentServiceDep,
) -> DrawAdjustmentResponse:
    """Get a draw adjustment by ID."""
    adjustment = await service.get(adjustment_id)
    if not adjustment:
        raise HTTPException(status_code=404, detail="Draw adjustment not found")
    return DrawAdjustmentResponse.model_validate(adjustment)


@router.patch("/{adjustment_id}", response_model=DrawAdjustmentResponse)
async def update_draw_adjustment(
    adjustment_id: str,
    data: DrawAdjustmentUpdate,
    service: DrawAdjustmentServiceDep,
) -> DrawAdjustmentResponse:
    """Update a draw adjustment."""
    adjustment = await service.update(adjustment_id, data)
    if not adjustment:
        raise HTTPException(status_code=404, detail="Draw adjustment not found")
    return DrawAdjustmentResponse.model_validate(adjustment)


@router.delete("/{adjustment_id}", status_code=204)
async def delete_draw_adjustment(
    adjustment_id: str,
    service: DrawAdjustmentServiceDep,
) -> None:
    """Delete a draw adjustment (soft delete by default)."""
    deleted = await service.delete(adjustment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Draw adjustment not found")
