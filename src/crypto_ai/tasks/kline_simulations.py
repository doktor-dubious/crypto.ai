"""Celery task for running kline (crypto) walk-forward simulations.

Long ranges (e.g. a full year of hourly data) produce thousands of one-step
forecasts and take minutes on CPU, so the simulation runs in the background with
incremental progress persisted to the task record. Mirrors the prediction /
simulation task patterns.
"""

import asyncio
from datetime import UTC, date, datetime

import structlog
from fastapi import HTTPException

from crypto_ai.database.connection import task_session
from crypto_ai.services.kline_simulation import KlineSimulationService, ModelDegradedError
from crypto_ai.services.kline_simulation_record import KlineSimulationRecordService
from crypto_ai.services.task import TaskService
from crypto_ai.tasks.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(
    bind=True,
    name="crypto_ai.tasks.kline_simulations.run_kline_simulation_task",
    time_limit=7200,  # 2h hard limit
    soft_time_limit=7000,
)
def run_kline_simulation_task(self, request_data: dict) -> dict:
    """Run a kline walk-forward simulation asynchronously."""
    return asyncio.run(
        _run_kline_simulation_async(self.request.id, request_data, self.request.hostname)
    )


async def _run_kline_simulation_async(
    task_id: str, request_data: dict, hostname: str | None = None
) -> dict:
    worker_name = hostname.split("@")[-1] if hostname else None
    record_id = request_data.get("record_id")

    async def _mark_record(status: str, *, result=None, error=None, finished=False) -> None:
        if not record_id:
            return
        async with task_session() as s:
            await KlineSimulationRecordService(s).mark(
                record_id, status, result=result, error=error, finished=finished
            )
            await s.commit()

    # Guard against Celery redelivery: only run a task still marked pending.
    async with task_session() as session:
        ts = TaskService(session)
        try:
            record = await ts.get(task_id)
            if record.status != "pending":
                return {"skipped": True, "reason": f"task status is {record.status}"}
        except HTTPException:
            return {"skipped": True, "reason": "redelivered task not in DB"}

        name = request_data.get("name") or "Kline simulation"
        await ts.update_status(
            task_id, "started", started_at=datetime.now(UTC),
            name=name, worker_name=worker_name,
        )
        await session.commit()

    await _mark_record("started")

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

    async def _on_progress(progress: int, message: str) -> None:
        last_progress[0] = (progress, message)
        await _persist(progress, message)

    async def _heartbeat() -> None:
        # Keep the task record fresh so orphan detection does not kill a long run.
        while True:
            await asyncio.sleep(60)
            try:
                await _persist(*last_progress[0])
            except Exception:
                pass

    from crypto_ai.tasks.celery_app import clear_stop_flag, is_stop_requested

    def _should_stop() -> bool:
        return is_stop_requested(task_id)

    heartbeat = asyncio.create_task(_heartbeat())
    try:
        await _on_progress(0, "Loading klines…")
        async with task_session() as session:
            service = KlineSimulationService(session)
            result = await service.run_simulation(
                coin_id=request_data["coin_id"],
                quote_asset=request_data["quote_asset"],
                interval=request_data["interval"],
                start_date=date.fromisoformat(request_data["start_date"]),
                end_date=date.fromisoformat(request_data["end_date"]),
                model_names=request_data["models"],
                on_progress=_on_progress,
                should_stop=_should_stop,
                include_full_predictions=bool(record_id),
                forecast_vol=bool(request_data.get("forecast_vol")),
                strategy=request_data.get("strategy", "price"),
                parameters=request_data.get("parameters") or None,
                horizon=int(request_data.get("horizon") or 1),
                # use_covariates is the pre-mode boolean form, still possible on
                # tasks enqueued before the covariate_mode rollout.
                covariate_mode=request_data.get("covariate_mode")
                or ("native" if request_data.get("use_covariates") else "off"),
            )

        # Persist the full per-timestamp forecasts to their own table, then strip
        # them from the result JSON kept on the simulation record.
        if record_id and isinstance(result, dict):
            await _on_progress(99, "Saving predictions…")
            async with task_session() as s:
                rec_service = KlineSimulationRecordService(s)
                for mname, mres in (result.get("models") or {}).items():
                    if isinstance(mres, dict):
                        rows = mres.pop("_predictions", None)
                        if rows:
                            await rec_service.add_predictions(record_id, mname, rows)
                await s.commit()

        was_stopped = is_stop_requested(task_id)
        clear_stop_flag(task_id)
        final_status = "stopped" if was_stopped else "success"

        async with task_session() as session:
            await TaskService(session).update_status(
                task_id,
                final_status,
                completed_at=datetime.now(UTC),
                error="Gracefully stopped" if was_stopped else None,
            )
            await session.commit()

        await _mark_record(
            final_status,
            result=result,
            error="Gracefully stopped" if was_stopped else None,
            finished=True,
        )
        return result
    except ModelDegradedError as e:
        # The requested model couldn't load and the engine fell back. Mark the
        # simulation "degraded" (distinct from a hard crash) so the master table
        # flags it instead of showing a green "Completed".
        log.warning(f"Kline simulation degraded: {e}")
        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "failure", completed_at=datetime.now(UTC), error=str(e)
            )
            await session.commit()
        await _mark_record("degraded", error=str(e), finished=True)
        raise
    except Exception as e:
        log.error(f"Kline simulation task failed: {e}", exc_info=True)
        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "failure", completed_at=datetime.now(UTC), error=str(e)
            )
            await session.commit()
        await _mark_record("failure", error=str(e), finished=True)
        raise
    finally:
        heartbeat.cancel()
        try:
            await heartbeat
        except (asyncio.CancelledError, Exception):
            pass
