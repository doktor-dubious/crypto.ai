"""Pad API routes."""

from datetime import date

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import PadServiceDep
from gorm_ai.schemas.pad import PadCreate, PadDateAdd, PadResponse, PadUpdate

router = APIRouter()


@router.post("", response_model=PadResponse, status_code=201)
async def create_pad(
    data: PadCreate,
    service: PadServiceDep,
) -> PadResponse:
    """Create a new pad."""
    pad = await service.create(data)
    return PadResponse.model_validate(pad)


@router.get("", response_model=list[PadResponse])
async def list_pads(
    customer_id: str,
    service: PadServiceDep,
) -> list[PadResponse]:
    """List all active pads for a customer."""
    pads = await service.list_by_customer(customer_id)
    return [PadResponse.model_validate(p) for p in pads]


@router.get("/{pad_id}", response_model=PadResponse)
async def get_pad(
    pad_id: str,
    service: PadServiceDep,
) -> PadResponse:
    """Get a pad by ID."""
    pad = await service.get(pad_id)
    if not pad:
        raise HTTPException(status_code=404, detail="Pad not found")
    return PadResponse.model_validate(pad)


@router.patch("/{pad_id}", response_model=PadResponse)
async def update_pad(
    pad_id: str,
    data: PadUpdate,
    service: PadServiceDep,
) -> PadResponse:
    """Update a pad."""
    pad = await service.update(pad_id, data)
    if not pad:
        raise HTTPException(status_code=404, detail="Pad not found")
    return PadResponse.model_validate(pad)


@router.delete("/{pad_id}", status_code=204)
async def delete_pad(
    pad_id: str,
    service: PadServiceDep,
) -> None:
    """Delete a pad (soft delete)."""
    if not await service.delete(pad_id):
        raise HTTPException(status_code=404, detail="Pad not found")


@router.post("/{pad_id}/dates", response_model=PadResponse)
async def add_dates(
    pad_id: str,
    data: PadDateAdd,
    service: PadServiceDep,
) -> PadResponse:
    """Add dates to a pad."""
    pad = await service.add_dates(pad_id, data)
    if not pad:
        raise HTTPException(status_code=404, detail="Pad not found")
    return PadResponse.model_validate(pad)


@router.delete("/{pad_id}/dates/{target_date}", status_code=204)
async def remove_date(
    pad_id: str,
    target_date: date,
    service: PadServiceDep,
) -> None:
    """Remove a specific date from a pad."""
    if not await service.remove_date(pad_id, target_date):
        raise HTTPException(status_code=404, detail="Date not found on pad")
