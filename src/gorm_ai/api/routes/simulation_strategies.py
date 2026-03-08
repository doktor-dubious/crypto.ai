"""SimulationStrategy API routes."""

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import SimulationStrategyServiceDep
from gorm_ai.schemas.simulation_strategy import (
    SimulationStrategyCreate,
    SimulationStrategyResponse,
    SimulationStrategyUpdate,
)

router = APIRouter()


@router.get("", response_model=list[SimulationStrategyResponse])
async def list_simulation_strategies(
    customer_id: str,
    service: SimulationStrategyServiceDep,
) -> list[SimulationStrategyResponse]:
    items = await service.list(customer_id)
    return [SimulationStrategyResponse.model_validate(s) for s in items]


@router.post("", response_model=SimulationStrategyResponse, status_code=201)
async def create_simulation_strategy(
    data: SimulationStrategyCreate,
    service: SimulationStrategyServiceDep,
) -> SimulationStrategyResponse:
    strategy = await service.create(data)
    return SimulationStrategyResponse.model_validate(strategy)


@router.patch("/{strategy_id}", response_model=SimulationStrategyResponse)
async def update_simulation_strategy(
    strategy_id: str,
    data: SimulationStrategyUpdate,
    service: SimulationStrategyServiceDep,
) -> SimulationStrategyResponse:
    strategy = await service.update(strategy_id, data)
    if not strategy:
        raise HTTPException(status_code=404, detail="SimulationStrategy not found")
    return SimulationStrategyResponse.model_validate(strategy)


@router.delete("/{strategy_id}", status_code=204)
async def delete_simulation_strategy(
    strategy_id: str,
    service: SimulationStrategyServiceDep,
) -> None:
    if not await service.delete(strategy_id):
        raise HTTPException(status_code=404, detail="SimulationStrategy not found")
