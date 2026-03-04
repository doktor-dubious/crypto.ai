"""Outlet group API routes."""

from fastapi import APIRouter, HTTPException, Query

from gorm_ai.api.deps import DrawAdjustmentServiceDep, OutletGroupServiceDep
from gorm_ai.schemas.draw_adjustment import DrawAdjustmentResponse
from gorm_ai.schemas.outlet_group import (
    OutletGroupCreate,
    OutletGroupMemberCreate,
    OutletGroupResponse,
    OutletGroupUpdate,
)

router = APIRouter()


@router.post("", response_model=OutletGroupResponse, status_code=201)
async def create_outlet_group(
    data: OutletGroupCreate,
    service: OutletGroupServiceDep,
) -> OutletGroupResponse:
    """Create a new outlet group."""
    group = await service.create(data)
    return OutletGroupResponse.model_validate(group)


@router.get("", response_model=list[OutletGroupResponse])
async def list_outlet_groups(
    service: OutletGroupServiceDep,
    customer_id: str | None = Query(default=None),
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[OutletGroupResponse]:
    """Get all outlet groups with optional customer filter."""
    groups = await service.get_all(customer_id=customer_id, limit=limit, offset=offset)
    return [OutletGroupResponse.model_validate(g) for g in groups]


@router.get("/{group_id}", response_model=OutletGroupResponse)
async def get_outlet_group(
    group_id: str,
    service: OutletGroupServiceDep,
) -> OutletGroupResponse:
    """Get an outlet group by ID."""
    group = await service.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Outlet group not found")
    return OutletGroupResponse.model_validate(group)


@router.patch("/{group_id}", response_model=OutletGroupResponse)
async def update_outlet_group(
    group_id: str,
    data: OutletGroupUpdate,
    service: OutletGroupServiceDep,
) -> OutletGroupResponse:
    """Update an outlet group."""
    group = await service.update(group_id, data)
    if not group:
        raise HTTPException(status_code=404, detail="Outlet group not found")
    return OutletGroupResponse.model_validate(group)


@router.delete("/{group_id}", status_code=204)
async def delete_outlet_group(
    group_id: str,
    service: OutletGroupServiceDep,
    hard_delete: bool = Query(default=False),
) -> None:
    """Delete an outlet group (soft delete by default)."""
    deleted = await service.delete(group_id, hard_delete=hard_delete)
    if not deleted:
        raise HTTPException(status_code=404, detail="Outlet group not found")


# Outlet group membership endpoints


@router.post("/{group_id}/outlets", status_code=201)
async def add_outlet_to_group(
    group_id: str,
    data: OutletGroupMemberCreate,
    service: OutletGroupServiceDep,
) -> dict:
    """Add an outlet to a group."""
    await service.add_outlet(group_id, data.outlet_id)
    return {"message": "Outlet added to group successfully"}


@router.delete("/{group_id}/outlets/{outlet_id}", status_code=204)
async def remove_outlet_from_group(
    group_id: str,
    outlet_id: str,
    service: OutletGroupServiceDep,
) -> None:
    """Remove an outlet from a group."""
    removed = await service.remove_outlet(group_id, outlet_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Outlet group membership not found")


# Draw adjustments for group


@router.get("/{group_id}/draw-adjustments", response_model=list[DrawAdjustmentResponse])
async def list_group_draw_adjustments(
    group_id: str,
    service: DrawAdjustmentServiceDep,
) -> list[DrawAdjustmentResponse]:
    """Get all draw adjustments for a group."""
    adjustments = await service.get_by_group(group_id)
    return [DrawAdjustmentResponse.model_validate(a) for a in adjustments]
