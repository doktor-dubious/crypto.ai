"""Sales API routes."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from gorm_ai.api.deps import SalesServiceDep
from gorm_ai.schemas.sales import SalesBulkImport, SalesCreate, SalesQuery, SalesResponse

router = APIRouter()


@router.post("", response_model=SalesResponse, status_code=201)
async def create_sales(
    data: SalesCreate,
    service: SalesServiceDep,
) -> SalesResponse:
    """Create a new sales record."""
    sales = await service.create(data)
    return SalesResponse.model_validate(sales)


@router.post("/bulk", response_model=list[SalesResponse], status_code=201)
async def bulk_import_sales(
    data: SalesBulkImport,
    service: SalesServiceDep,
) -> list[SalesResponse]:
    """Bulk import sales records."""
    sales_records = await service.bulk_import(data)
    return [SalesResponse.model_validate(s) for s in sales_records]


@router.get("/date-range")
async def get_sales_date_range(
    customer_id: str,
    service: SalesServiceDep,
) -> dict:
    """Return the min and max sales date for a customer."""
    min_date, max_date = await service.get_date_range(customer_id)
    return {
        "min_date": min_date.isoformat() if min_date else None,
        "max_date": max_date.isoformat() if max_date else None,
    }


@router.get("", response_model=list[SalesResponse])
async def query_sales(
    service: SalesServiceDep,
    customer_id: str | None = Query(default=None),
    outlet_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[SalesResponse]:
    """Query sales records with filters."""
    query = SalesQuery(
        customer_id=customer_id,
        outlet_id=outlet_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )
    sales = await service.query(query)
    return [SalesResponse.model_validate(s) for s in sales]


@router.get("/{sales_id}", response_model=SalesResponse)
async def get_sales(
    sales_id: str,
    service: SalesServiceDep,
) -> SalesResponse:
    """Get a sales record by ID."""
    sales = await service.get(sales_id)
    if not sales:
        raise HTTPException(status_code=404, detail="Sales record not found")
    return SalesResponse.model_validate(sales)


@router.delete("/{sales_id}", status_code=204)
async def delete_sales(
    sales_id: str,
    service: SalesServiceDep,
    hard_delete: bool = Query(default=False),
) -> None:
    """Delete a sales record (soft delete by default)."""
    deleted = await service.delete(sales_id, hard_delete=hard_delete)
    if not deleted:
        raise HTTPException(status_code=404, detail="Sales record not found")
