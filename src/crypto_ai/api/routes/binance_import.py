"""API routes for importing Binance kline data."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from crypto_ai.api.deps import BinanceImportServiceDep, DbSession, TaskServiceDep

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

            # Parse the file
            klines = await service.import_from_file(tmp.name, coin_id, interval, quote_asset)

            # Create klines in database
            from crypto_ai.database.models.kline import Kline

            objs = [Kline(**k.model_dump()) for k in klines]
            service.session.add_all(objs)
            await service.session.flush()

            return {
                "status": "success",
                "imported_count": len(klines),
                "message": f"Successfully imported {len(klines)} klines",
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
        imported = 0
        total = 0
        try:
            async for imported, total, message in service.import_from_binance(
                symbol, interval, coin_id, quote_asset, start_date, end_date
            ):
                yield f"data: {{'imported': {imported}, 'total': {total}, 'message': '{message}'}}\n\n"

            await service.session.commit()
            yield f"data: {{'imported': {imported}, 'total': {total}, 'message': 'Import complete!', 'status': 'success'}}\n\n"
        except Exception as e:
            await service.session.rollback()
            yield f"data: {{'message': 'Import failed: {str(e)}', 'status': 'error'}}\n\n"

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
