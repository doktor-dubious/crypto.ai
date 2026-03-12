"""SalesFilter API routes."""

from fastapi import APIRouter, HTTPException, Query

from gorm_ai.api.deps import SalesFilterServiceDep
from gorm_ai.schemas.sales_filter import (
    SalesFilterCreate,
    SalesFilterResponse,
    SalesFilterUpdate,
)

router = APIRouter()


@router.get("", response_model=list[SalesFilterResponse])
async def list_sales_filters(
    customer_id: str,
    service: SalesFilterServiceDep,
) -> list[SalesFilterResponse]:
    """List all active sales filters for a customer."""
    filters = await service.list_by_customer(customer_id)
    return [SalesFilterResponse.model_validate(f) for f in filters]


@router.post("", response_model=SalesFilterResponse, status_code=201)
async def create_sales_filter(
    data: SalesFilterCreate,
    service: SalesFilterServiceDep,
) -> SalesFilterResponse:
    """Create a new sales filter."""
    sf = await service.create(data)
    return SalesFilterResponse.model_validate(sf)


@router.patch("/{filter_id}", response_model=SalesFilterResponse)
async def update_sales_filter(
    filter_id: str,
    data: SalesFilterUpdate,
    service: SalesFilterServiceDep,
) -> SalesFilterResponse:
    """Update a sales filter."""
    sf = await service.update(filter_id, data)
    if not sf:
        raise HTTPException(status_code=404, detail="Sales filter not found")
    return SalesFilterResponse.model_validate(sf)


@router.delete("/{filter_id}", status_code=204)
async def delete_sales_filter(
    filter_id: str,
    service: SalesFilterServiceDep,
) -> None:
    """Delete a sales filter (soft delete)."""
    if not await service.delete(filter_id):
        raise HTTPException(status_code=404, detail="Sales filter not found")
