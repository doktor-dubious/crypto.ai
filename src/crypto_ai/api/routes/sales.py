"""Sales API routes."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import (
    ConfigurationServiceDep,
    CustomerConfigurationServiceDep,
    SalesServiceDep,
)
from crypto_ai.schemas.sales import (
    AggregatedSalesDataPoint,
    AggregatedSalesRequest,
    AggregatedSalesResponse,
    EfficiencyDataPoint,
    EfficiencyResponse,
    FinancialsPerDateDataPoint,
    FinancialsPerDateResponse,
    FinancialsPerOutletDataPoint,
    FinancialsPerOutletResponse,
    FinancialsRequest,
    SalesBulkImport,
    SalesCreate,
    SalesQuery,
    SalesResponse,
)

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


@router.post("/aggregated", response_model=AggregatedSalesResponse)
async def get_aggregated_sales(
    data: AggregatedSalesRequest,
    service: SalesServiceDep,
) -> AggregatedSalesResponse:
    """Aggregate sales by date across multiple outlets."""
    rows = await service.get_aggregated(
        customer_id=data.customer_id,
        outlet_ids=data.outlet_ids,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    return AggregatedSalesResponse(
        data=[AggregatedSalesDataPoint(**r) for r in rows],
        outlet_count=len(data.outlet_ids),
    )


@router.post("/efficiency", response_model=EfficiencyResponse)
async def get_efficiency(
    data: AggregatedSalesRequest,
    service: SalesServiceDep,
) -> EfficiencyResponse:
    """Compute return % and sold-out % by date across outlets."""
    rows = await service.get_efficiency(
        customer_id=data.customer_id,
        outlet_ids=data.outlet_ids,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    return EfficiencyResponse(
        data=[EfficiencyDataPoint(**r) for r in rows],
        outlet_count=len(data.outlet_ids),
    )


async def _resolve_defaults(
    customer_id: str,
    cust_cfg_service: CustomerConfigurationServiceDep,
    global_cfg_service: ConfigurationServiceDep,
) -> tuple[float, float]:
    """Resolve default cost/profit per unit from customer then global config."""
    cust_cfg = await cust_cfg_service.get_by_customer(customer_id)
    cost = cust_cfg.cost_per_unit if cust_cfg and cust_cfg.cost_per_unit is not None else None
    profit = cust_cfg.profit_per_unit if cust_cfg and cust_cfg.profit_per_unit is not None else None

    if cost is None or profit is None:
        global_cfg = await global_cfg_service.get()
        if cost is None:
            cost = global_cfg.cost_per_unit if global_cfg and global_cfg.cost_per_unit is not None else 0.0
        if profit is None:
            profit = global_cfg.profit_per_unit if global_cfg and global_cfg.profit_per_unit is not None else 1.0

    return cost, profit


@router.post("/financials/per-date", response_model=FinancialsPerDateResponse)
async def get_financials_per_date(
    data: FinancialsRequest,
    service: SalesServiceDep,
    cust_cfg_service: CustomerConfigurationServiceDep,
    global_cfg_service: ConfigurationServiceDep,
) -> FinancialsPerDateResponse:
    """Compute revenue/cost/profit aggregated per date."""
    default_cost, default_profit = await _resolve_defaults(
        data.customer_id, cust_cfg_service, global_cfg_service
    )
    rows = await service.get_financials_per_date(
        customer_id=data.customer_id,
        outlet_ids=data.outlet_ids,
        start_date=data.start_date,
        end_date=data.end_date,
        default_cost=default_cost,
        default_profit=default_profit,
    )
    return FinancialsPerDateResponse(
        data=[FinancialsPerDateDataPoint(**r) for r in rows],
        outlet_count=len(data.outlet_ids),
    )


@router.post("/financials/per-outlet", response_model=FinancialsPerOutletResponse)
async def get_financials_per_outlet(
    data: FinancialsRequest,
    service: SalesServiceDep,
    cust_cfg_service: CustomerConfigurationServiceDep,
    global_cfg_service: ConfigurationServiceDep,
) -> FinancialsPerOutletResponse:
    """Compute revenue/cost/profit per outlet over the period."""
    default_cost, default_profit = await _resolve_defaults(
        data.customer_id, cust_cfg_service, global_cfg_service
    )
    rows = await service.get_financials_per_outlet(
        customer_id=data.customer_id,
        outlet_ids=data.outlet_ids,
        start_date=data.start_date,
        end_date=data.end_date,
        default_cost=default_cost,
        default_profit=default_profit,
    )
    return FinancialsPerOutletResponse(
        data=[FinancialsPerOutletDataPoint(**r) for r in rows],
    )


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
