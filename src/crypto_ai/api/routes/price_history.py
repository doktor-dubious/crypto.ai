"""Price history API routes."""

from fastapi import APIRouter, HTTPException

from crypto_ai.api.deps import PriceHistoryServiceDep
from crypto_ai.schemas.price_history import (
    PriceHistoryCreate,
    PriceHistoryResponse,
    PriceHistoryUpdate,
)

router = APIRouter()


@router.get("", response_model=list[PriceHistoryResponse])
async def list_price_history(
    customer_id: str,
    service: PriceHistoryServiceDep,
) -> list[PriceHistoryResponse]:
    """List all price history entries for a customer."""
    entries = await service.list_by_customer(customer_id)
    return [PriceHistoryResponse.model_validate(e) for e in entries]


@router.post("", response_model=list[PriceHistoryResponse], status_code=201)
async def create_price_history(
    data: PriceHistoryCreate,
    service: PriceHistoryServiceDep,
) -> list[PriceHistoryResponse]:
    """Create price history entries (one per weekday)."""
    entries = await service.create(data)
    return [PriceHistoryResponse.model_validate(e) for e in entries]


@router.patch("/{entry_id}", response_model=PriceHistoryResponse)
async def update_price_history(
    entry_id: str,
    data: PriceHistoryUpdate,
    service: PriceHistoryServiceDep,
) -> PriceHistoryResponse:
    """Update a price history entry."""
    entry = await service.update(entry_id, data)
    if not entry:
        raise HTTPException(status_code=404, detail="Price history entry not found")
    return PriceHistoryResponse.model_validate(entry)


@router.delete("/{entry_id}", status_code=204)
async def delete_price_history(
    entry_id: str,
    service: PriceHistoryServiceDep,
) -> None:
    """Delete a price history entry (soft delete)."""
    deleted = await service.delete(entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Price history entry not found")
