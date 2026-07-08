"""Fine-tuning Celery task."""

import asyncio
from datetime import UTC, datetime

from fastapi import HTTPException

from crypto_ai.tasks.celery_app import celery_app


@celery_app.task(
    bind=True,
    name="crypto_ai.tasks.finetuning.run_finetune_task",
    time_limit=604800,  # 7d — without an override the global 1h limit SIGKILLs long fine-tunes
    soft_time_limit=604500,
)
def run_finetune_task(self, request_data: dict) -> dict:
    """Run a fine-tuning task asynchronously."""
    return asyncio.run(_run_finetune_async(self.request.id, request_data, self.request.hostname))


async def _run_finetune_async(
    task_id: str, request_data: dict, hostname: str | None = None,
) -> dict:
    """Actual async fine-tuning logic."""
    from crypto_ai.database.connection import task_session
    from crypto_ai.services.task import TaskService

    worker_name = (hostname or "").split("@", 1)[-1] or None

    # Redelivery guard
    async with task_session() as session:
        ts = TaskService(session)
        try:
            record = await ts.get(task_id)
            if record.status != "pending":
                return {"skipped": True, "reason": f"task status is {record.status}"}
        except HTTPException:
            return {"skipped": True, "reason": "redelivered task not in DB"}

        await ts.update_status(
            task_id, "started",
            started_at=datetime.now(UTC),
            worker_name=worker_name,
        )
        await session.commit()

    last_progress: list[tuple[int, str | None]] = [(0, "Starting…")]

    async def _persist(progress: int, message: str | None = None) -> None:
        from crypto_ai.tasks.celery_app import get_current_metrics, refresh_worker_registry
        refresh_worker_registry()
        async with task_session() as session:
            ts = TaskService(session)
            await ts.update_progress(task_id, progress, message)
            peak_mem, cpu_time = get_current_metrics(task_id)
            if peak_mem is not None:
                await ts.update_resource_metrics(task_id, peak_mem, cpu_time)
            await session.commit()

    async def _on_progress(progress: int, message: str | None = None) -> None:
        last_progress[0] = (progress, message)
        await _persist(progress, message)

    async def _heartbeat() -> None:
        # Crypto fine-tunes train a single series, so on_progress can stay
        # silent for hours; keep the task record fresh so orphan detection
        # doesn't mark a live run "Worker lost". Mirrors the simulation task.
        while True:
            await asyncio.sleep(60)
            try:
                await _persist(*last_progress[0])
            except Exception:
                pass

    fine_tune_id = request_data.get("fine_tune_id")

    # Point the DB log handler at this run so log lines are persisted
    from crypto_ai.logging_db import get_finetune_db_handler

    db_log_handler = get_finetune_db_handler()
    if db_log_handler:
        db_log_handler.set_fine_tune_id(fine_tune_id)

    heartbeat = asyncio.create_task(_heartbeat())
    try:
        from crypto_ai.services.finetune import FinetuneService
        from crypto_ai.tasks.celery_app import clear_stop_flag, is_stop_requested

        def _should_stop() -> bool:
            return is_stop_requested(task_id)

        async with task_session() as session:
            service = FinetuneService(session)
            result = await service.run_finetune(
                request_data, on_progress=_on_progress, should_stop=_should_stop,
            )
            await session.commit()

        clear_stop_flag(task_id)

        if result.get("stopped"):
            async with task_session() as session:
                await TaskService(session).update_status(
                    task_id, "stopped",
                    completed_at=datetime.now(UTC),
                    error="Gracefully stopped",
                )
                if fine_tune_id:
                    from crypto_ai.services.fine_tune import FineTuneTrackingService
                    ft_svc = FineTuneTrackingService(session)
                    await ft_svc.update_counts(
                        fine_tune_id,
                        finetuned_outlets=result.get("finetuned_count", 0),
                        pathological_outlets=result.get("pathological_count", 0),
                    )
                    await ft_svc.complete(fine_tune_id, "stopped")
                await session.commit()
            return result

        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "success", completed_at=datetime.now(UTC)
            )
            if fine_tune_id:
                from crypto_ai.services.fine_tune import FineTuneTrackingService
                ft_svc = FineTuneTrackingService(session)
                await ft_svc.update_counts(
                    fine_tune_id,
                    finetuned_outlets=result.get("finetuned_count", 0),
                    pathological_outlets=result.get("pathological_count", 0),
                )
                await ft_svc.complete(fine_tune_id, "completed")
            await session.commit()

        return result

    except Exception as e:
        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "failure", completed_at=datetime.now(UTC), error=str(e)
            )
            if fine_tune_id:
                from crypto_ai.services.fine_tune import FineTuneTrackingService
                ft_svc = FineTuneTrackingService(session)
                await ft_svc.complete(fine_tune_id, "error")
            await session.commit()
        raise
    finally:
        heartbeat.cancel()
        try:
            await heartbeat
        except (asyncio.CancelledError, Exception):
            pass
        if db_log_handler:
            db_log_handler.set_fine_tune_id(None)
