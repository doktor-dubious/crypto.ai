"""Outlet API routes."""

from fastapi import APIRouter, HTTPException, Query

from gorm_ai.api.deps import OutletServiceDep
from gorm_ai.schemas.outlet import (
    DeliveryAnalyticsResponse,
    OutletCreate,
    OutletDeliveryCreate,
    OutletDeliveryResponse,
    OutletInfoCreate,
    OutletInfoResponse,
    OutletResponse,
    OutletUpdate,
)

router = APIRouter()


@router.post("", response_model=OutletResponse, status_code=201)
async def create_outlet(
    data: OutletCreate,
    service: OutletServiceDep,
) -> OutletResponse:
    """Create a new outlet."""
    outlet = await service.create(data)
    return OutletResponse.model_validate(outlet)


@router.get("", response_model=list[OutletResponse])
async def list_outlets(
    service: OutletServiceDep,
    customer_id: str | None = Query(default=None),
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
    include_inactive: bool = Query(default=False),
) -> list[OutletResponse]:
    """Get all outlets with optional customer filter."""
    outlets = await service.get_all(
        customer_id=customer_id,
        limit=limit,
        offset=offset,
        include_inactive=include_inactive,
    )
    return [OutletResponse.model_validate(o) for o in outlets]


@router.get("/{outlet_id}", response_model=OutletResponse)
async def get_outlet(
    outlet_id: str,
    service: OutletServiceDep,
) -> OutletResponse:
    """Get an outlet by ID."""
    outlet = await service.get(outlet_id)
    if not outlet:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return OutletResponse.model_validate(outlet)


@router.get("/ext/{ext_id}", response_model=OutletResponse)
async def get_outlet_by_ext_id(
    ext_id: str,
    service: OutletServiceDep,
    customer_id: str | None = Query(default=None),
) -> OutletResponse:
    """Get an outlet by external ID."""
    outlet = await service.get_by_ext_id(ext_id, customer_id)
    if not outlet:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return OutletResponse.model_validate(outlet)


@router.patch("/{outlet_id}", response_model=OutletResponse)
async def update_outlet(
    outlet_id: str,
    data: OutletUpdate,
    service: OutletServiceDep,
) -> OutletResponse:
    """Update an outlet."""
    outlet = await service.update(outlet_id, data)
    if not outlet:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return OutletResponse.model_validate(outlet)


@router.delete("/{outlet_id}", status_code=204)
async def delete_outlet(
    outlet_id: str,
    service: OutletServiceDep,
    hard_delete: bool = Query(default=False),
) -> None:
    """Delete an outlet (soft delete by default)."""
    deleted = await service.delete(outlet_id, hard_delete=hard_delete)
    if not deleted:
        raise HTTPException(status_code=404, detail="Outlet not found")


# Info routes
@router.post("/{outlet_id}/info", response_model=OutletInfoResponse, status_code=201)
async def add_outlet_info(
    outlet_id: str,
    data: OutletInfoCreate,
    service: OutletServiceDep,
) -> OutletInfoResponse:
    """Add info record to an outlet."""
    info = await service.add_info(outlet_id, data)
    if not info:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return OutletInfoResponse.model_validate(info)


@router.delete("/{outlet_id}/info/{info_id}", status_code=204)
async def delete_outlet_info(
    outlet_id: str,
    info_id: str,
    service: OutletServiceDep,
) -> None:
    """Delete an outlet info record (soft delete)."""
    deleted = await service.delete_info(outlet_id, info_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Outlet info not found")


# Delivery analytics
@router.get("/{outlet_id}/delivery-analytics", response_model=DeliveryAnalyticsResponse)
async def get_outlet_delivery_analytics(
    outlet_id: str,
    service: OutletServiceDep,
) -> DeliveryAnalyticsResponse:
    """Get delivery analytics per weekday for an outlet."""
    result = await service.get_delivery_analytics(outlet_id)
    if not result:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return result


# Delivery routes
@router.get("/{outlet_id}/deliveries", response_model=list[OutletDeliveryResponse])
async def list_outlet_deliveries(
    outlet_id: str,
    service: OutletServiceDep,
) -> list[OutletDeliveryResponse]:
    """Get all deliveries for an outlet."""
    deliveries = await service.get_deliveries(outlet_id)
    return [OutletDeliveryResponse.model_validate(d) for d in deliveries]


@router.post("/{outlet_id}/deliveries", response_model=OutletDeliveryResponse, status_code=201)
async def add_outlet_delivery(
    outlet_id: str,
    data: OutletDeliveryCreate,
    service: OutletServiceDep,
) -> OutletDeliveryResponse:
    """Add delivery record to an outlet."""
    delivery = await service.add_delivery(outlet_id, data)
    if not delivery:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return OutletDeliveryResponse.model_validate(delivery)
