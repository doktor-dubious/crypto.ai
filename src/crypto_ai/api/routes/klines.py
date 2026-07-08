"""API routes for kline (OHLCV) data."""

import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.api.deps import DbSession, KlineServiceDep, TaskServiceDep, get_db
from crypto_ai.schemas.kline import KlineCreate, KlineListResponse, KlineResponse, KlineUpdate
from crypto_ai.services.kline_simulation import KlineSimulationService

router = APIRouter()


@router.post("", response_model=KlineResponse, status_code=201)
async def create_kline(data: KlineCreate, service: KlineServiceDep) -> KlineResponse:
    """Create a new kline."""
    kline = await service.create(data)
    return kline


@router.post("/bulk", response_model=KlineListResponse, status_code=201)
async def create_klines_bulk(
    klines: list[KlineCreate], service: KlineServiceDep
) -> KlineListResponse:
    """Create multiple klines in bulk."""
    created = await service.create_many(klines)
    return KlineListResponse(klines=created, count=len(created))


@router.get("", response_model=list[KlineResponse])
async def list_klines(
    service: KlineServiceDep,
    coin_id: Annotated[str | None, Query()] = None,
    quote_asset: Annotated[str | None, Query()] = None,
    interval: Annotated[str | None, Query()] = None,
    start_time: Annotated[datetime | None, Query()] = None,
    end_time: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[KlineResponse]:
    """List klines with optional filtering by coin, quote asset, interval, and time range."""
    klines = await service.get_all(
        coin_id=coin_id,
        quote_asset=quote_asset,
        interval=interval,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=offset,
    )
    return klines


@router.get("/coin/{coin_id}", response_model=list[KlineResponse])
async def get_klines_by_coin(
    coin_id: str,
    service: KlineServiceDep,
    interval: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
) -> list[KlineResponse]:
    """Get klines for a specific coin."""
    if interval:
        klines = await service.get_by_coin_and_interval(coin_id, interval, limit)
    else:
        klines = await service.get_all(coin_id=coin_id, limit=limit)
    return klines


@router.get("/coin/{coin_id}/latest", response_model=KlineResponse)
async def get_latest_kline(
    coin_id: str,
    service: KlineServiceDep,
    interval: Annotated[str, Query()] = "1d",
) -> KlineResponse:
    """Get the latest kline for a coin and interval."""
    kline = await service.get_latest(coin_id, interval)
    if not kline:
        raise HTTPException(status_code=404, detail="No kline data found")
    return kline


@router.get("/pair-counts")
async def get_pair_counts(service: KlineServiceDep) -> dict[str, int]:
    """Number of distinct trading pairs (with loaded data) per coin, keyed by coin id."""
    return await service.get_pair_counts_by_coin()


@router.get("/last-updated")
async def get_last_updated(service: KlineServiceDep) -> dict[str, str]:
    """Most recent data-update timestamp (ISO 8601) per coin id."""
    data = await service.get_last_updated_by_coin()
    return {coin_id: ts.isoformat() for coin_id, ts in data.items()}


@router.get("/avg-daily-volume")
async def get_avg_daily_volume(
    service: KlineServiceDep,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> dict[str, float]:
    """Average daily traded value in USDT over the last `days` 1d bars, per coin id."""
    return await service.get_avg_daily_volume_by_coin(days)


@router.get("/{kline_id}", response_model=KlineResponse)
async def get_kline(kline_id: str, service: KlineServiceDep) -> KlineResponse:
    """Get a specific kline."""
    kline = await service.get(kline_id)
    if not kline:
        raise HTTPException(status_code=404, detail="Kline not found")
    return kline


@router.patch("/{kline_id}", response_model=KlineResponse)
async def update_kline(
    kline_id: str, data: KlineUpdate, service: KlineServiceDep
) -> KlineResponse:
    """Update a kline."""
    kline = await service.update(kline_id, data)
    if not kline:
        raise HTTPException(status_code=404, detail="Kline not found")
    return kline


@router.delete("/{kline_id}")
async def delete_kline(
    kline_id: str, service: KlineServiceDep, hard_delete: bool = False
) -> dict[str, bool]:
    """Delete a kline."""
    success = await service.delete(kline_id, hard_delete=hard_delete)
    if not success:
        raise HTTPException(status_code=404, detail="Kline not found")
    return {"success": True}


@router.delete("")
async def delete_klines_bulk(
    service: KlineServiceDep,
    coin_id: Annotated[str, Query()],
    quote_asset: Annotated[str, Query()],
    interval: Annotated[str, Query()],
) -> dict[str, int]:
    """Delete all klines for a specific coin, quote asset, and interval."""
    count = await service.delete_by_filters(coin_id, quote_asset, interval)
    return {"deleted_count": count}


@router.get("/pairs/{coin_id}")
async def get_trading_pairs(
    coin_id: str,
    service: KlineServiceDep,
) -> dict[str, list[str]]:
    """Get available trading pairs (quote assets) for a coin."""
    pairs = await service.get_quote_assets_by_coin(coin_id)
    return {"pairs": pairs}


@router.get("/range/{coin_id}/{quote_asset}/{interval}")
async def get_kline_range(
    coin_id: str,
    quote_asset: str,
    interval: str,
    service: KlineServiceDep,
) -> dict[str, str | None]:
    """Earliest/latest available date for a coin/pair/timeframe (for date pickers)."""
    lo, hi = await service.get_date_range(coin_id, quote_asset, interval)
    return {
        "start_date": lo.date().isoformat() if lo else None,
        "end_date": hi.date().isoformat() if hi else None,
    }


@router.get("/timeframes/{coin_id}/{quote_asset}")
async def get_timeframes(
    coin_id: str,
    quote_asset: str,
    service: KlineServiceDep,
) -> dict[str, list[str]]:
    """Get available timeframes for a trading pair."""
    timeframes = await service.get_intervals_by_coin_and_quote(coin_id, quote_asset)
    return {"timeframes": timeframes}


@router.post("/simulate")
async def simulate_klines(
    coin_id: Annotated[str, Query()],
    quote_asset: Annotated[str, Query()],
    interval: Annotated[str, Query()],
    start_date: Annotated[date, Query()],
    end_date: Annotated[date, Query()],
    models: Annotated[list[str], Query()],
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Run AI model simulations on kline data.

    Tests multiple AI models' ability to predict price direction and volatility
    on historical kline data. Uses 80/20 train/test split.

    Query parameters:
    - coin_id: UUID of the coin
    - quote_asset: Quote asset (e.g., USDT)
    - interval: Timeframe (e.g., 1h, 15m, 1d)
    - start_date: Start date (YYYY-MM-DD)
    - end_date: End date (YYYY-MM-DD)
    - models: List of model names to test (e.g., ?models=statistical&models=timesfm)
    """
    if start_date >= end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")

    if not models:
        raise HTTPException(status_code=400, detail="At least one model must be specified")

    service = KlineSimulationService(session)
    try:
        result = await service.run_simulation(
            coin_id=coin_id,
            quote_asset=quote_asset,
            interval=interval,
            start_date=start_date,
            end_date=end_date,
            model_names=models,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/simulate-async")
async def simulate_klines_async(
    coin_id: Annotated[str, Query()],
    quote_asset: Annotated[str, Query()],
    interval: Annotated[str, Query()],
    start_date: Annotated[date, Query()],
    end_date: Annotated[date, Query()],
    models: Annotated[list[str], Query()],
    task_service: TaskServiceDep,
    session: DbSession,
) -> dict:
    """Enqueue a walk-forward kline simulation as a background task.

    Returns a task_id immediately; poll GET /klines/simulate-tasks/{task_id}
    for progress and the final result.
    """
    if start_date >= end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    if not models:
        raise HTTPException(status_code=400, detail="At least one model must be specified")

    from crypto_ai.tasks.kline_simulations import run_kline_simulation_task

    request_data = {
        "coin_id": coin_id,
        "quote_asset": quote_asset,
        "interval": interval,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "models": models,
        "name": f"{', '.join(models)} · {interval} · {start_date}→{end_date}",
    }

    # Pre-generate the id and persist the record BEFORE enqueuing, so the worker
    # (which guards against running tasks not yet in the DB) can never race us.
    task_id = str(uuid.uuid4())
    await task_service.create(
        task_id, "kline_simulation", None,
        name=request_data["name"], request_data=request_data,
    )
    await session.commit()

    run_kline_simulation_task.apply_async(args=[request_data], task_id=task_id)
    return {"task_id": task_id, "status": "pending"}


@router.get("/simulate-tasks/{task_id}")
async def get_kline_simulation_status(
    task_id: str,
    task_service: TaskServiceDep,
) -> dict:
    """Return status + progress for a kline simulation, and the result when done."""
    from crypto_ai.tasks.celery_app import celery_app

    record = None
    try:
        record = await task_service.get(task_id)
    except HTTPException:
        pass

    status = record.status if record else "pending"
    result = None
    if status == "success":
        async_result = celery_app.AsyncResult(task_id)
        if async_result.state == "SUCCESS":
            result = async_result.result

    return {
        "task_id": task_id,
        "status": status,
        "progress": record.progress if record else 0,
        "progress_message": record.progress_message if record else None,
        "error": record.error if record else None,
        "result": result,
    }
