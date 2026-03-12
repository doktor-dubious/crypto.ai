"""Predefined PAD API routes."""

from fastapi import APIRouter, HTTPException, Query

from gorm_ai.api.deps import PredefinedPadServiceDep
from gorm_ai.schemas.predefined_pad import (
    PredefinedPadCreate,
    PredefinedPadDateAdd,
    PredefinedPadResponse,
    PredefinedPadUpdate,
)

router = APIRouter()


@router.post("", response_model=PredefinedPadResponse, status_code=201)
async def create_predefined_pad(
    data: PredefinedPadCreate,
    service: PredefinedPadServiceDep,
) -> PredefinedPadResponse:
    pad = await service.create(data)
    return PredefinedPadResponse.model_validate(pad)


@router.get("", response_model=list[PredefinedPadResponse])
async def list_predefined_pads(
    service: PredefinedPadServiceDep,
    country: str | None = Query(default=None),
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[PredefinedPadResponse]:
    pads = await service.get_all(country=country, limit=limit, offset=offset)
    return [PredefinedPadResponse.model_validate(p) for p in pads]


@router.get("/{pad_id}", response_model=PredefinedPadResponse)
async def get_predefined_pad(
    pad_id: str,
    service: PredefinedPadServiceDep,
) -> PredefinedPadResponse:
    pad = await service.get(pad_id)
    if not pad:
        raise HTTPException(status_code=404, detail="Predefined PAD not found")
    return PredefinedPadResponse.model_validate(pad)


@router.patch("/{pad_id}", response_model=PredefinedPadResponse)
async def update_predefined_pad(
    pad_id: str,
    data: PredefinedPadUpdate,
    service: PredefinedPadServiceDep,
) -> PredefinedPadResponse:
    pad = await service.update(pad_id, data)
    if not pad:
        raise HTTPException(status_code=404, detail="Predefined PAD not found")
    return PredefinedPadResponse.model_validate(pad)


@router.delete("/{pad_id}", status_code=204)
async def delete_predefined_pad(
    pad_id: str,
    service: PredefinedPadServiceDep,
    hard_delete: bool = Query(default=False),
) -> None:
    deleted = await service.delete(pad_id, hard_delete=hard_delete)
    if not deleted:
        raise HTTPException(status_code=404, detail="Predefined PAD not found")


@router.post("/{pad_id}/dates", response_model=PredefinedPadResponse)
async def add_dates(
    pad_id: str,
    data: PredefinedPadDateAdd,
    service: PredefinedPadServiceDep,
) -> PredefinedPadResponse:
    pad = await service.add_dates(pad_id, data.dates)
    if not pad:
        raise HTTPException(status_code=404, detail="Predefined PAD not found")
    return PredefinedPadResponse.model_validate(pad)


@router.delete("/{pad_id}/dates/{date_id}", status_code=204)
async def remove_date(
    pad_id: str,
    date_id: str,
    service: PredefinedPadServiceDep,
) -> None:
    removed = await service.remove_date(pad_id, date_id)
    if not removed:
        raise HTTPException(status_code=404, detail="PAD date not found")
