"""API routes for importing Binance kline data."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from crypto_ai.api.deps import (
    BinanceImportServiceDep,
    CoinServiceDep,
    DbSession,
    KlineServiceDep,
    TaskServiceDep,
)

router = APIRouter()


@router.post("/upload")
async def import_from_file(
    service: BinanceImportServiceDep,
    file: UploadFile,
    coin_id: Annotated[str, Query()],
    interval: Annotated[str, Query()],
    quote_asset: Annotated[str, Query(description="Quote asset (USDT, USD, etc.)")] = "USDT",
) -> dict:
    """Import klines from an uploaded file (CSV, ZIP, or GZ)."""
    try:
        # Save uploaded file temporarily
        import tempfile

        with tempfile.NamedTemporaryFile(delete=False, suffix=file.filename or "") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp.flush()

            # Parse the file and upsert (skips bars already present)
            klines = await service.import_from_file(tmp.name, coin_id, interval, quote_asset)
            inserted = await service.insert_klines(klines)

            return {
                "status": "success",
                "imported_count": inserted,
                "message": f"Successfully imported {inserted} klines"
                + (f" ({len(klines) - inserted} already present)" if inserted < len(klines) else ""),
            }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/binance")
async def import_from_binance(
    service: BinanceImportServiceDep,
    symbol: Annotated[str, Query(description="Binance symbol (e.g., BTCUSDT)")],
    interval: Annotated[
        str, Query(description="Kline interval (5m, 15m, 1h, 4h, 1d, 1w, 1M)")
    ],
    coin_id: Annotated[str, Query(description="Coin UUID")],
    quote_asset: Annotated[str, Query(description="Quote asset (USDT, USD, etc.)")] = "USDT",
    start_date: Annotated[str | None, Query(description="Start date (YYYY-MM-DD)")] = None,
    end_date: Annotated[str | None, Query(description="End date (YYYY-MM-DD)")] = None,
) -> StreamingResponse:
    """Import klines directly from Binance data source with streaming progress."""

    async def event_generator():
        import json

        imported = 0
        total = 0
        try:
            async for imported, total, message in service.import_from_binance(
                symbol, interval, coin_id, quote_asset, start_date, end_date
            ):
                yield f"data: {json.dumps({'imported': imported, 'total': total, 'message': message})}\n\n"

            await service.session.commit()
            yield f"data: {json.dumps({'imported': imported, 'total': total, 'message': 'Import complete!', 'status': 'success'})}\n\n"
        except Exception as e:
            await service.session.rollback()
            yield f"data: {json.dumps({'message': f'Import failed: {e}', 'status': 'error'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/binance-async")
async def import_from_binance_async(
    task_service: TaskServiceDep,
    session: DbSession,
    symbol: Annotated[str, Query(description="Binance symbol (e.g., BTCUSDT)")],
    interval: Annotated[str, Query(description="Kline interval (5m, 15m, 1h, 4h, 1d, 1w, 1M)")],
    coin_id: Annotated[str, Query(description="Coin UUID")],
    quote_asset: Annotated[str, Query()] = "USDT",
    start_date: Annotated[str | None, Query()] = None,
    end_date: Annotated[str | None, Query()] = None,
) -> dict:
    """Enqueue a Binance import as a background task; returns a task_id.

    Poll GET /binance-import/tasks/{task_id} for progress. Multiple imports can
    run concurrently.
    """
    from crypto_ai.tasks.imports import run_binance_import_task

    rng = f" {start_date}→{end_date}" if start_date or end_date else ""
    request_data = {
        "symbol": symbol,
        "interval": interval,
        "coin_id": coin_id,
        "quote_asset": quote_asset,
        "start_date": start_date,
        "end_date": end_date,
        "name": f"{symbol} {interval}{rng}",
    }

    # Persist the record before enqueuing so the worker can't race us.
    task_id = str(uuid.uuid4())
    await task_service.create(
        task_id, "import", None, name=request_data["name"], request_data=request_data
    )
    await session.commit()

    run_binance_import_task.apply_async(args=[request_data], task_id=task_id)
    return {"task_id": task_id, "status": "pending", "name": request_data["name"]}


async def _plan_coin_refresh(coin, kline_service) -> list[dict]:
    """Build one import request per standard interval for the coin's USDT pair.

    Every interval in STANDARD_INTERVALS is refreshed against the USDT quote asset:
    intervals that already have data are topped up from their last stored bar to
    today; intervals with no data yet are back-filled from BINANCE_EARLIEST_DATE.
    Overlapping bars are skipped on insert (ON CONFLICT DO NOTHING), so re-running
    is safe.
    """
    from datetime import UTC, datetime

    from crypto_ai.services.binance_import import (
        BINANCE_EARLIEST_DATE,
        STANDARD_INTERVALS,
        fetch_earliest_listing_date,
    )

    # Latest stored bar per interval for the USDT pair (missing → back-fill all).
    combos = await kline_service.get_loaded_combos(coin.id)
    last_by_interval = {iv: hi for qa, iv, hi in combos if qa == "USDT"}

    today = datetime.now(UTC).date().isoformat()
    symbol = f"{coin.symbol}USDT"

    # Intervals with no data are back-filled from the coin's actual first bar
    # (probed once via REST), not the 2017 floor — otherwise a coin listed later
    # (e.g. DODO 2021, BROCCOLI714 2025) 404s on every pre-listing monthly archive.
    # Fall back to the 2017 floor if the probe fails.
    backfill_start = BINANCE_EARLIEST_DATE
    if any(iv not in last_by_interval for iv in STANDARD_INTERVALS):
        listing = await fetch_earliest_listing_date(symbol)
        if listing:
            backfill_start = listing

    requests: list[dict] = []
    for interval in STANDARD_INTERVALS:
        last_open = last_by_interval.get(interval)
        start_date = last_open.date().isoformat() if last_open else backfill_start
        requests.append(
            {
                "symbol": symbol,
                "interval": interval,
                "coin_id": coin.id,
                "quote_asset": "USDT",
                "start_date": start_date,
                "end_date": today,
                "name": f"{symbol} {interval} {start_date}→{today}",
            }
        )
    return requests


@router.post("/refresh-coin")
async def refresh_coin_data(
    task_service: TaskServiceDep,
    session: DbSession,
    coin_service: CoinServiceDep,
    kline_service: KlineServiceDep,
    coin_id: Annotated[str, Query(description="Coin UUID")],
) -> dict:
    """Update all standard intervals for a coin (USDT pair) from Binance.

    Enqueues one background import per interval in STANDARD_INTERVALS: loaded
    intervals are topped up from their last bar, missing intervals are back-filled
    from the earliest available data. Returns the enqueued tasks; poll each via
    GET /binance-import/tasks/{id}.
    """
    from crypto_ai.tasks.imports import run_binance_import_task

    coin = await coin_service.get(coin_id)
    if not coin:
        raise HTTPException(status_code=404, detail="Coin not found")

    enqueued: list[tuple[str, dict]] = []
    for request_data in await _plan_coin_refresh(coin, kline_service):
        task_id = str(uuid.uuid4())
        await task_service.create(
            task_id, "import", None, name=request_data["name"], request_data=request_data
        )
        enqueued.append((task_id, request_data))

    # Commit all records before enqueuing so workers can't race the inserts.
    await session.commit()
    for task_id, request_data in enqueued:
        run_binance_import_task.apply_async(args=[request_data], task_id=task_id)

    tasks = [
        {
            "task_id": task_id,
            "name": rd["name"],
            "quote_asset": rd["quote_asset"],
            "interval": rd["interval"],
        }
        for task_id, rd in enqueued
    ]
    return {"tasks": tasks, "count": len(tasks)}


@router.post("/refresh-coins")
async def refresh_coins_data(
    task_service: TaskServiceDep,
    session: DbSession,
    coin_service: CoinServiceDep,
    kline_service: KlineServiceDep,
    coin_ids: Annotated[list[str], Query(description="Coin UUIDs")],
) -> dict:
    """Update all standard intervals (USDT pair) for several coins at once.

    Same per-coin behavior as /refresh-coin; unknown coin ids are skipped. Returns
    the combined set of enqueued tasks across all coins.
    """
    from crypto_ai.tasks.imports import run_binance_import_task

    enqueued: list[tuple[str, dict]] = []
    for coin_id in coin_ids:
        coin = await coin_service.get(coin_id)
        if not coin:
            continue
        for request_data in await _plan_coin_refresh(coin, kline_service):
            task_id = str(uuid.uuid4())
            await task_service.create(
                task_id, "import", None, name=request_data["name"], request_data=request_data
            )
            enqueued.append((task_id, request_data))

    # Commit all records before enqueuing so workers can't race the inserts.
    await session.commit()
    for task_id, request_data in enqueued:
        run_binance_import_task.apply_async(args=[request_data], task_id=task_id)

    tasks = [
        {
            "task_id": task_id,
            "name": rd["name"],
            "quote_asset": rd["quote_asset"],
            "interval": rd["interval"],
        }
        for task_id, rd in enqueued
    ]
    return {"tasks": tasks, "count": len(tasks)}


@router.get("/tasks/{task_id}")
async def get_import_status(task_id: str, task_service: TaskServiceDep) -> dict:
    """Status + progress for a background import; imported_count when done."""
    from crypto_ai.tasks.celery_app import celery_app

    record = None
    try:
        record = await task_service.get(task_id)
    except HTTPException:
        pass

    status = record.status if record else "pending"
    imported_count = None
    if status == "success":
        async_result = celery_app.AsyncResult(task_id)
        if async_result.state == "SUCCESS" and isinstance(async_result.result, dict):
            imported_count = async_result.result.get("imported_count")

    return {
        "task_id": task_id,
        "status": status,
        "progress": record.progress if record else 0,
        "progress_message": record.progress_message if record else None,
        "error": record.error if record else None,
        "imported_count": imported_count,
    }


@router.get("/binance/preview")
async def preview_binance_url(
    service: BinanceImportServiceDep,
    url: Annotated[str, Query(description="Binance data URL")],
) -> dict:
    """Preview what will be imported from a Binance URL."""
    result = service.parse_symbol_from_url(url)
    if not result:
        raise HTTPException(
            status_code=400,
            detail="Could not parse symbol and interval from URL. Expected format: https://data.binance.vision/?prefix=data/spot/daily/klines/BTCUSDT/1h/",
        )

    symbol, interval = result
    return {
        "symbol": symbol,
        "interval": interval,
        "url": url,
        "example_request": f"/api/v1/binance-import?symbol={symbol}&interval={interval}&coin_id=<your-coin-id>",
    }
