"""API routes for persisted kline simulation runs."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import DbSession, KlineSimulationRecordServiceDep, TaskServiceDep
from crypto_ai.database.models.kline_simulation import KlineSimulation
from crypto_ai.schemas.kline_simulation import (
    BacktestResponse,
    KlineSimulationCreate,
    KlineSimulationListResponse,
    KlineSimulationPredictionListResponse,
    KlineSimulationPredictionResponse,
    KlineSimulationResponse,
    KlineSimulationStatusResponse,
    KlineSimulationUpdate,
)

router = APIRouter()


def _to_response(rec: KlineSimulation) -> KlineSimulationResponse:
    resp = KlineSimulationResponse.model_validate(rec)
    resp.coin_symbol = rec.coin.symbol if rec.coin else None
    return resp


@router.post("", response_model=KlineSimulationResponse, status_code=201)
async def create_kline_simulation(
    data: KlineSimulationCreate,
    service: KlineSimulationRecordServiceDep,
    task_service: TaskServiceDep,
    session: DbSession,
) -> KlineSimulationResponse:
    """Create a simulation record and enqueue the walk-forward task."""
    if data.start_date >= data.end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    if not data.models:
        raise HTTPException(status_code=400, detail="At least one model must be specified")

    from crypto_ai.tasks.kline_simulations import run_kline_simulation_task

    if data.strategy not in ("price", "kline", "price_volatility"):
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {data.strategy}")

    config = dict(data.config or {})
    if data.forecast_vol:
        config["forecast_vol"] = True

    rec = await service.create(
        coin_id=data.coin_id,
        quote_asset=data.quote_asset,
        interval=data.interval,
        start_date=data.start_date,
        end_date=data.end_date,
        models=data.models,
        name=data.name,
        description=data.description,
        strategy=data.strategy,
        config=config or None,
    )

    # Persist the record + task record BEFORE enqueuing so the worker can never
    # race us (it guards against running a task not yet in the DB).
    task_id = str(uuid.uuid4())
    display_name = data.name or (
        f"{', '.join(data.models)} · {data.interval} · {data.start_date}→{data.end_date}"
    )
    request_data = {
        "record_id": rec.id,
        "coin_id": data.coin_id,
        "quote_asset": data.quote_asset,
        "interval": data.interval,
        "start_date": data.start_date.isoformat(),
        "end_date": data.end_date.isoformat(),
        "models": data.models,
        "forecast_vol": data.forecast_vol,
        "strategy": data.strategy,
        # Engine parameters from the chosen Simulation Strategy preset (name→value).
        "parameters": config.get("parameters") or {},
        "name": display_name,
    }
    await task_service.create(
        task_id, "kline_simulation", None,
        name=request_data["name"], request_data=request_data,
    )
    await service.set_task(rec.id, task_id)
    await session.commit()

    # Route to a specific worker's queue when requested (its WORKER_NAME, which
    # each worker consumes alongside the default "celery" queue); otherwise let
    # any available worker pick it up.
    dispatch_kwargs: dict = {"args": [request_data], "task_id": task_id}
    if data.worker:
        dispatch_kwargs["queue"] = data.worker
    run_kline_simulation_task.apply_async(**dispatch_kwargs)

    rec = await service.get(rec.id)
    return _to_response(rec)


@router.get("", response_model=KlineSimulationListResponse)
async def list_kline_simulations(
    service: KlineSimulationRecordServiceDep,
    search: Annotated[str | None, Query()] = None,
    sort_field: Annotated[str, Query()] = "created_at",
    sort_dir: Annotated[str, Query()] = "desc",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> KlineSimulationListResponse:
    """List simulation runs (master table)."""
    items, total = await service.list(
        search=search, sort_field=sort_field, sort_dir=sort_dir, limit=limit, offset=offset
    )
    return KlineSimulationListResponse(
        items=[_to_response(r) for r in items], total=total
    )


@router.get("/{sim_id}", response_model=KlineSimulationResponse)
async def get_kline_simulation(
    sim_id: str, service: KlineSimulationRecordServiceDep
) -> KlineSimulationResponse:
    rec = await service.get(sim_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return _to_response(rec)


@router.get("/{sim_id}/status", response_model=KlineSimulationStatusResponse)
async def get_kline_simulation_status(
    sim_id: str,
    service: KlineSimulationRecordServiceDep,
    task_service: TaskServiceDep,
) -> KlineSimulationStatusResponse:
    """Live status + progress (from the task record), and result when finished."""
    rec = await service.get(sim_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Simulation not found")

    progress = 0
    message = None
    if rec.task_id:
        try:
            tr = await task_service.get(rec.task_id)
            progress = tr.progress
            message = tr.progress_message
        except HTTPException:
            pass

    return KlineSimulationStatusResponse(
        id=rec.id,
        task_id=rec.task_id,
        status=rec.status,
        progress=progress,
        progress_message=message,
        error=rec.error,
        result=rec.result,
    )


@router.get("/{sim_id}/predictions", response_model=KlineSimulationPredictionListResponse)
async def list_kline_simulation_predictions(
    sim_id: str,
    service: KlineSimulationRecordServiceDep,
    model: Annotated[str | None, Query()] = None,
    sort_field: Annotated[str, Query()] = "timestamp",
    sort_dir: Annotated[str, Query()] = "asc",
    limit: Annotated[int, Query(ge=1, le=100000)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    direction: Annotated[str | None, Query()] = None,
    forecast: Annotated[str | None, Query()] = None,
) -> KlineSimulationPredictionListResponse:
    """Paginated full per-timestamp forecasts for a simulation.

    `direction` optionally filters to up-call outcomes: "correct" (forecast up &
    rose) or "faulty" (forecast up & fell). `forecast` selects which value drives
    the direction columns/sort: the point forecast (default) or q10..q50.
    """
    items, total = await service.list_predictions(
        sim_id, model=model, sort_field=sort_field, sort_dir=sort_dir,
        limit=limit, offset=offset, direction=direction, forecast=forecast,
    )
    models = await service.prediction_model_names(sim_id)
    inside, graded = await service.prediction_coverage(sim_id, model=model)
    mape = await service.prediction_mape(sim_id, model=model)
    return KlineSimulationPredictionListResponse(
        items=[KlineSimulationPredictionResponse.model_validate(p) for p in items],
        total=total,
        models=models,
        coverage_inside=inside,
        coverage_total=graded,
        mape=mape,
    )


@router.get("/{sim_id}/backtest", response_model=BacktestResponse)
async def backtest_kline_simulation(
    sim_id: str,
    service: KlineSimulationRecordServiceDep,
    model: Annotated[str | None, Query()] = None,
    threshold: Annotated[float, Query(ge=0.0, le=1.0)] = 0.6,
    fee_bps: Annotated[float, Query(ge=0.0, le=100.0)] = 15.0,
    min_edge_pct: Annotated[float, Query(ge=0.0, le=20.0)] = 0.0,
    vol_mode: Annotated[str | None, Query()] = None,
    cover_fees: Annotated[bool, Query()] = False,
    position_sizing: Annotated[str, Query()] = "none",
    pyramid_steps: Annotated[int, Query(ge=1, le=50)] = 4,
    allow_short: Annotated[bool, Query()] = False,
) -> BacktestResponse:
    """Fee-aware long-only backtest of a confidence-thresholded strategy.

    Goes long for one bar whenever prob_up >= threshold; charges fee_bps round
    trip per position change. Compares against buy-and-hold over the same bars.
    `vol_mode` ("vol_targeting" | "vol_breakout") optionally applies a
    volatility-aware sizing/filter rule on top of the base signal.
    `cover_fees` requires the forecast move to clear the round-trip fee (on top
    of any min_edge_pct), so only trades expected to beat costs are taken.
    """
    result = await service.backtest(
        sim_id, model=model, threshold=threshold, fee_bps=fee_bps,
        min_edge_pct=min_edge_pct, vol_mode=vol_mode, cover_fees=cover_fees,
        position_sizing=position_sizing, pyramid_steps=pyramid_steps,
        allow_short=allow_short,
    )
    if result is None:
        raise HTTPException(status_code=400, detail="No quantile-based predictions to backtest")
    return BacktestResponse(**result)


@router.patch("/{sim_id}", response_model=KlineSimulationResponse)
async def update_kline_simulation(
    sim_id: str, data: KlineSimulationUpdate, service: KlineSimulationRecordServiceDep
) -> KlineSimulationResponse:
    rec = await service.update(sim_id, data)
    if not rec:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return _to_response(rec)


@router.delete("/{sim_id}")
async def delete_kline_simulation(
    sim_id: str, service: KlineSimulationRecordServiceDep
) -> dict[str, bool]:
    ok = await service.delete(sim_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return {"success": True}
