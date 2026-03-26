"""SimulationFilter API routes."""

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import SimulationFilterServiceDep
from gorm_ai.schemas.simulation_filter import (
    SimulationFilterCreate,
    SimulationFilterResponse,
    SimulationFilterUpdate,
)

router = APIRouter()


@router.get("", response_model=list[SimulationFilterResponse])
async def list_simulation_filters(
    customer_id: str,
    service: SimulationFilterServiceDep,
) -> list[SimulationFilterResponse]:
    """List all active simulation filters for a customer."""
    filters = await service.list_by_customer(customer_id)
    return [SimulationFilterResponse.model_validate(f) for f in filters]


@router.post("", response_model=SimulationFilterResponse, status_code=201)
async def create_simulation_filter(
    data: SimulationFilterCreate,
    service: SimulationFilterServiceDep,
) -> SimulationFilterResponse:
    """Create a new simulation filter."""
    sf = await service.create(data)
    return SimulationFilterResponse.model_validate(sf)


@router.patch("/{filter_id}", response_model=SimulationFilterResponse)
async def update_simulation_filter(
    filter_id: str,
    data: SimulationFilterUpdate,
    service: SimulationFilterServiceDep,
) -> SimulationFilterResponse:
    """Update a simulation filter."""
    sf = await service.update(filter_id, data)
    if not sf:
        raise HTTPException(status_code=404, detail="Simulation filter not found")
    return SimulationFilterResponse.model_validate(sf)


@router.delete("/{filter_id}", status_code=204)
async def delete_simulation_filter(
    filter_id: str,
    service: SimulationFilterServiceDep,
) -> None:
    """Delete a simulation filter (soft delete)."""
    if not await service.delete(filter_id):
        raise HTTPException(status_code=404, detail="Simulation filter not found")
