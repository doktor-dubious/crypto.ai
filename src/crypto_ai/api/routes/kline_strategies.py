"""KlineStrategy routes: crypto-simulation presets and their parameters."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import KlineStrategyServiceDep
from crypto_ai.schemas.kline_strategy import (
    KlineStrategyCreate,
    KlineStrategyParameterCreate,
    KlineStrategyParameterResponse,
    KlineStrategyParameterUpdate,
    KlineStrategyResponse,
    KlineStrategyUpdate,
)

router = APIRouter()


# ─── Strategies ──────────────────────────────────────────────────────────────


@router.post("", response_model=KlineStrategyResponse, status_code=201)
async def create_strategy(
    data: KlineStrategyCreate, service: KlineStrategyServiceDep
) -> KlineStrategyResponse:
    """Create a new strategy preset."""
    return await service.create(data)


@router.get("", response_model=list[KlineStrategyResponse])
async def list_strategies(
    service: KlineStrategyServiceDep,
    limit: Annotated[int, Query(ge=1, le=1000)] = 1000,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_inactive: bool = False,
) -> list[KlineStrategyResponse]:
    """List strategy presets."""
    return await service.get_all(limit=limit, offset=offset, include_inactive=include_inactive)


@router.get("/{strategy_id}", response_model=KlineStrategyResponse)
async def get_strategy(strategy_id: str, service: KlineStrategyServiceDep) -> KlineStrategyResponse:
    """Get a single strategy preset."""
    strategy = await service.get(strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return strategy


@router.patch("/{strategy_id}", response_model=KlineStrategyResponse)
async def update_strategy(
    strategy_id: str, data: KlineStrategyUpdate, service: KlineStrategyServiceDep
) -> KlineStrategyResponse:
    """Update a strategy preset."""
    strategy = await service.update(strategy_id, data)
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return strategy


@router.delete("/{strategy_id}")
async def delete_strategy(
    strategy_id: str, service: KlineStrategyServiceDep, hard_delete: bool = False
) -> dict[str, bool]:
    """Delete a strategy preset."""
    ok = await service.delete(strategy_id, hard_delete=hard_delete)
    if not ok:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {"success": True}


# ─── Parameters ──────────────────────────────────────────────────────────────


@router.get("/{strategy_id}/parameters", response_model=list[KlineStrategyParameterResponse])
async def list_parameters(
    strategy_id: str, service: KlineStrategyServiceDep
) -> list[KlineStrategyParameterResponse]:
    """List the parameters attached to a strategy."""
    return await service.list_parameters(strategy_id)


@router.post(
    "/{strategy_id}/parameters",
    response_model=KlineStrategyParameterResponse,
    status_code=201,
)
async def add_parameter(
    strategy_id: str,
    data: KlineStrategyParameterCreate,
    service: KlineStrategyServiceDep,
) -> KlineStrategyParameterResponse:
    """Add a parameter to a strategy."""
    param = await service.add_parameter(strategy_id, data)
    if not param:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return param


@router.post(
    "/{strategy_id}/copy-engine-parameters",
    response_model=list[KlineStrategyParameterResponse],
)
async def copy_engine_parameters(
    strategy_id: str,
    engine_slug: Annotated[str, Query()],
    service: KlineStrategyServiceDep,
) -> list[KlineStrategyParameterResponse]:
    """Copy the selected engine's parameters onto the strategy (returns new params)."""
    added = await service.copy_engine_parameters(strategy_id, engine_slug)
    if added is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return added


@router.patch(
    "/{strategy_id}/parameters/{param_id}",
    response_model=KlineStrategyParameterResponse,
)
async def update_parameter(
    strategy_id: str,
    param_id: str,
    data: KlineStrategyParameterUpdate,
    service: KlineStrategyServiceDep,
) -> KlineStrategyParameterResponse:
    """Update a parameter (e.g. toggle selected)."""
    param = await service.update_parameter(param_id, data)
    if not param:
        raise HTTPException(status_code=404, detail="Parameter not found")
    return param


@router.delete("/{strategy_id}/parameters/{param_id}")
async def delete_parameter(
    strategy_id: str, param_id: str, service: KlineStrategyServiceDep
) -> dict[str, bool]:
    """Delete a parameter."""
    ok = await service.delete_parameter(param_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Parameter not found")
    return {"success": True}
