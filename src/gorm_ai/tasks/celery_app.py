"""Celery application configuration."""

import asyncio
import os

from celery import Celery
from celery.signals import task_postrun, task_prerun, worker_process_init

from gorm_ai.config import get_settings

settings = get_settings()

celery_app = Celery(
    "gorm_ai",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["gorm_ai.tasks.predictions", "gorm_ai.tasks.simulations"],
)

# Celery configuration
@worker_process_init.connect
def init_worker_logging(**kwargs):
    """Configure logging in each Celery worker process."""
    from gorm_ai.logging import configure_logging
    configure_logging()


# Per-task resource tracking: task_id -> (cpu_start, mem_rss_start)
_task_start_metrics: dict[str, tuple[float, int]] = {}


def get_current_metrics(task_id: str) -> tuple[float | None, float | None]:
    """Return (peak_memory_mb, cpu_time_s) for a running task, or (None, None)."""
    start = _task_start_metrics.get(task_id)
    if start is None:
        return None, None
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        cpu_end = sum(proc.cpu_times()[:2])
        mem_end = proc.memory_info().rss
        cpu_start, mem_start = start
        cpu_time_s = round(cpu_end - cpu_start, 2)
        peak_memory_mb = round(max(mem_end, mem_start) / (1024 * 1024), 1)
        return peak_memory_mb, cpu_time_s
    except Exception:
        return None, None


@task_prerun.connect
def on_task_prerun(task_id: str, **kwargs) -> None:
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        cpu = sum(proc.cpu_times()[:2])
        mem = proc.memory_info().rss
        _task_start_metrics[task_id] = (cpu, mem)
    except Exception:
        pass


@task_postrun.connect
def on_task_postrun(task_id: str, **kwargs) -> None:
    start = _task_start_metrics.pop(task_id, None)
    if start is None:
        return
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        cpu_end = sum(proc.cpu_times()[:2])
        mem_end = proc.memory_info().rss

        cpu_start, mem_start = start
        cpu_time_s = round(cpu_end - cpu_start, 2)
        peak_memory_mb = round(max(mem_end, mem_start) / (1024 * 1024), 1)

        async def _write() -> None:
            from gorm_ai.database.connection import task_session
            from gorm_ai.services.task import TaskService
            async with task_session() as session:
                await TaskService(session).update_resource_metrics(task_id, peak_memory_mb, cpu_time_s)
                await session.commit()

        asyncio.run(_write())
    except Exception:
        pass


celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,  # 1 hour max
    task_soft_time_limit=3000,  # 50 minutes soft limit
    worker_prefetch_multiplier=1,
    worker_concurrency=4,
    # Solo pool: when the worker is killed mid-task (e.g. revoke with
    # terminate=True), do NOT re-queue the message.  Without this the
    # cancelled task gets redelivered after the container restarts.
    task_reject_on_worker_lost=False,
)
