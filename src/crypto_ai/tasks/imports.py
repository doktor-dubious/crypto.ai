"""Celery task for importing Binance kline data in the background.

Running imports as background tasks lets several run concurrently (up to the
worker's concurrency) instead of holding an SSE request open per import.
"""

import asyncio
from datetime import UTC, datetime

import structlog
from fastapi import HTTPException

from crypto_ai.database.connection import task_session
from crypto_ai.services.binance_import import BinanceImportService
from crypto_ai.services.task import TaskService
from crypto_ai.tasks.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(
    bind=True,
    name="crypto_ai.tasks.imports.run_binance_import_task",
    time_limit=14400,  # 4h hard limit (multi-year imports are big)
    soft_time_limit=14100,
)
def run_binance_import_task(self, request_data: dict) -> dict:
    """Download + import Binance klines asynchronously."""
    return asyncio.run(
        _run_binance_import_async(self.request.id, request_data, self.request.hostname)
    )


async def _run_binance_import_async(
    task_id: str, request_data: dict, hostname: str | None = None
) -> dict:
    worker_name = hostname.split("@")[-1] if hostname else None

    # Guard against Celery redelivery.
    async with task_session() as session:
        ts = TaskService(session)
        try:
            record = await ts.get(task_id)
            if record.status != "pending":
                return {"skipped": True, "reason": f"task status is {record.status}"}
        except HTTPException:
            return {"skipped": True, "reason": "redelivered task not in DB"}

        name = request_data.get("name") or "Import"
        await ts.update_status(
            task_id, "started", started_at=datetime.now(UTC),
            name=name, worker_name=worker_name,
        )
        await session.commit()

    last_progress: list[tuple[int, str]] = [(0, "Starting…")]

    async def _persist(progress: int, message: str) -> None:
        from crypto_ai.tasks.celery_app import get_current_metrics, refresh_worker_registry
        refresh_worker_registry()
        async with task_session() as s:
            ts = TaskService(s)
            await ts.update_progress(task_id, progress, message)
            peak_mem, cpu_time = get_current_metrics(task_id)
            if peak_mem is not None:
                await ts.update_resource_metrics(task_id, peak_mem, cpu_time)
            await s.commit()

    async def _heartbeat() -> None:
        while True:
            await asyncio.sleep(60)
            try:
                await _persist(*last_progress[0])
            except Exception:
                pass

    heartbeat = asyncio.create_task(_heartbeat())
    imported = 0
    try:
        async with task_session() as session:
            service = BinanceImportService(session)
            done_files = 0
            async for imp, total, message in service.import_from_binance(
                symbol=request_data["symbol"],
                interval=request_data["interval"],
                coin_id=request_data["coin_id"],
                quote_asset=request_data.get("quote_asset", "USDT"),
                start_date=request_data.get("start_date"),
                end_date=request_data.get("end_date"),
            ):
                imported = imp
                total = total or 1
                if message.startswith("Downloading"):
                    # Transient pre-fetch message; let the heartbeat surface it.
                    last_progress[0] = (last_progress[0][0], message)
                else:
                    # A file finished — persist its klines and bump progress.
                    await session.commit()
                    done_files += 1
                    progress = min(99, int(done_files / total * 100))
                    last_progress[0] = (progress, message)
                    await _persist(progress, message)
            await session.commit()

        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "success", completed_at=datetime.now(UTC)
            )
            await session.commit()

        return {"imported_count": imported}
    except Exception as e:
        log.error(f"Binance import task failed: {e}", exc_info=True)
        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "failure", completed_at=datetime.now(UTC), error=str(e)
            )
            await session.commit()
        raise
    finally:
        heartbeat.cancel()
        try:
            await heartbeat
        except (asyncio.CancelledError, Exception):
            pass
