"""API routes for strategy parameter-grid optimizations (the Optimize tab)."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import DbSession, StrategyOptimizationServiceDep
from crypto_ai.schemas.strategy_optimization import (
    OptimizationCreate,
    OptimizationEstimate,
    OptimizationResponse,
    OptimizationResultResponse,
    OptimizationUpdate,
)
from crypto_ai.services.strategy_optimization import UnsupportedCoinModeError

router = APIRouter()


@router.get("", response_model=list[OptimizationResponse])
async def list_optimizations(
    service: StrategyOptimizationServiceDep,
    strategy: Annotated[str | None, Query(description="Filter by strategy slug")] = None,
) -> list[OptimizationResponse]:
    """Every optimization, newest first, with live progress and ETA."""
    return await service.list(strategy=strategy)


@router.post("/estimate", response_model=OptimizationEstimate)
async def estimate(
    data: OptimizationCreate, service: StrategyOptimizationServiceDep
) -> OptimizationEstimate:
    """What a spec would cost, before committing to it — the dialog's counter.

    Separate from create so the count can update as boxes are ticked, and so the
    warning thresholds are based on the same arithmetic the runner will use.
    """
    try:
        return await service.estimate(data)
    except UnsupportedCoinModeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("", response_model=OptimizationResponse, status_code=201)
async def create_optimization(
    data: OptimizationCreate, service: StrategyOptimizationServiceDep, session: DbSession
) -> OptimizationResponse:
    """Create an optimization and enqueue it."""
    try:
        await service.estimate(data)  # rejects unsupported coin modes up front
    except UnsupportedCoinModeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if data.start_date >= data.end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")

    opt = await service.create(data)
    await session.commit()
    try:
        from crypto_ai.tasks.strategy_optimization import run_optimization

        run_optimization.delay(opt.id)
    except Exception:  # pragma: no cover - broker optional in some contexts
        pass
    return service._to_response(opt)


@router.get("/{optimization_id}", response_model=OptimizationResponse)
async def get_optimization(
    optimization_id: str, service: StrategyOptimizationServiceDep
) -> OptimizationResponse:
    opt = await service.get(optimization_id)
    if opt is None or not opt.active:
        raise HTTPException(status_code=404, detail="Optimization not found")
    return service._to_response(opt)


@router.get("/{optimization_id}/results", response_model=list[OptimizationResultResponse])
async def optimization_results(
    optimization_id: str,
    service: StrategyOptimizationServiceDep,
    limit: Annotated[int, Query(ge=1, le=5000)] = 2000,
) -> list[OptimizationResultResponse]:
    """Every variation's score, best TRAIN edge first (validation beside it)."""
    opt = await service.get(optimization_id)
    if opt is None or not opt.active:
        raise HTTPException(status_code=404, detail="Optimization not found")
    return await service.results(optimization_id, limit=limit)


@router.patch("/{optimization_id}", response_model=OptimizationResponse)
async def update_optimization(
    optimization_id: str, data: OptimizationUpdate, service: StrategyOptimizationServiceDep
) -> OptimizationResponse:
    opt = await service.update(optimization_id, data)
    if opt is None:
        raise HTTPException(status_code=404, detail="Optimization not found")
    return service._to_response(opt)


@router.delete("/{optimization_id}", status_code=204)
async def delete_optimization(
    optimization_id: str, service: StrategyOptimizationServiceDep
) -> None:
    if not await service.delete(optimization_id):
        raise HTTPException(status_code=404, detail="Optimization not found")
