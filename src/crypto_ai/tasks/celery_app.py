"""Celery application configuration."""

import asyncio
import logging
import os
import threading

from celery import Celery
from celery.signals import (
    task_postrun,
    task_prerun,
    worker_process_init,
    worker_ready,
    worker_shutdown,
)

from crypto_ai.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

celery_app = Celery(
    "crypto_ai",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["crypto_ai.tasks.predictions", "crypto_ai.tasks.simulations", "crypto_ai.tasks.finetuning", "crypto_ai.tasks.optimization", "crypto_ai.tasks.finetune_examination", "crypto_ai.tasks.kline_simulations", "crypto_ai.tasks.imports", "crypto_ai.tasks.orchestration", "crypto_ai.tasks.metadata", "crypto_ai.tasks.paper_trade",
        "crypto_ai.tasks.strategy_optimization", "crypto_ai.tasks.live_trade"],
)

# Periodic schedule (run the worker with embedded beat, ``celery worker -B``).
# The paper- and live-trade engines tick ~once a minute, stepping every running
# run forward by any newly-closed bars.
celery_app.conf.beat_schedule = {
    "step-paper-trades": {
        "task": "crypto_ai.tasks.paper_trade.step_paper_trades",
        "schedule": 60.0,
    },
    "step-live-trades": {
        "task": "crypto_ai.tasks.live_trade.step_live_trades",
        "schedule": 60.0,
    },
    # Sweep rotation: swap out paper-trade runs past their dwell time and top
    # the fleet back up with the next untried strategy×coin combos.
    "rotate-paper-sweeps": {
        "task": "crypto_ai.tasks.paper_trade.rotate_paper_sweeps",
        "schedule": 3600.0,
    },
}
celery_app.conf.timezone = "UTC"

# Celery configuration
@worker_process_init.connect
def init_worker_logging(**kwargs):
    """Configure logging in each Celery worker process."""
    from crypto_ai.logging import configure_logging
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


def _refresh_worker_registry(hostname: str | None = None) -> None:
    """Refresh this worker's TTL in the Redis registry.

    Called from Celery signals (prerun/postrun) and can also be called
    from within a running task via ``refresh_worker_registry()`` to keep
    long-running tasks alive in the registry. The idle heartbeat passes the
    hostname explicitly (a background thread can't rely on the current-worker
    lookup).
    """
    try:
        if hostname is None:
            hostname = celery_app.current_worker.hostname  # type: ignore[union-attr]
        r = _get_redis()
        r.setex(f"{WORKER_REGISTRY_PREFIX}{hostname}", WORKER_REGISTRY_TTL, "1")
        models = _get_worker_models()
        if models:
            r.setex(f"{WORKER_MODELS_PREFIX}{hostname}", WORKER_REGISTRY_TTL, models)
        gpu_index = os.environ.get("WORKER_GPU_INDEX")
        if gpu_index is not None:
            r.setex(f"{WORKER_GPU_PREFIX}{hostname}", WORKER_REGISTRY_TTL, gpu_index)

        # Refresh GPU hardware info and uptime (set-if-missing for started_at,
        # always refresh TTL for the rest).
        if not r.exists(f"{WORKER_STARTED_PREFIX}{hostname}"):
            import time
            r.setex(f"{WORKER_STARTED_PREFIX}{hostname}", WORKER_REGISTRY_TTL, str(int(time.time())))
        else:
            r.expire(f"{WORKER_STARTED_PREFIX}{hostname}", WORKER_REGISTRY_TTL)

        # Lazily populate GPU info if not yet stored (first task after deploy)
        if not r.exists(f"{WORKER_GPU_NAME_PREFIX}{hostname}"):
            try:
                from crypto_ai.services.resource_estimator import get_system_capacity
                cap = get_system_capacity()
                if cap.gpu_name:
                    r.setex(f"{WORKER_GPU_NAME_PREFIX}{hostname}", WORKER_REGISTRY_TTL, cap.gpu_name)
                    logger.info("Worker %s GPU lazily registered: %s", hostname, cap.gpu_name)
                if cap.gpu_vram_total_mb is not None:
                    r.setex(f"{WORKER_GPU_VRAM_PREFIX}{hostname}", WORKER_REGISTRY_TTL, str(int(cap.gpu_vram_total_mb)))
                if cap.gpu_count > 0:
                    r.setex(f"{WORKER_GPU_COUNT_PREFIX}{hostname}", WORKER_REGISTRY_TTL, str(cap.gpu_count))
            except Exception:
                logger.exception("Worker %s: lazy GPU detection failed", hostname)
        else:
            for prefix in (WORKER_GPU_NAME_PREFIX, WORKER_GPU_VRAM_PREFIX, WORKER_GPU_COUNT_PREFIX):
                r.expire(f"{prefix}{hostname}", WORKER_REGISTRY_TTL)
    except Exception:
        pass


def refresh_worker_registry() -> None:
    """Public alias for refreshing this worker's Redis registry TTL.

    Call from long-running tasks (e.g. progress callbacks) to prevent the
    2-hour TTL from expiring while the task is still computing.
    """
    _refresh_worker_registry()


@task_prerun.connect
def on_task_prerun(task_id: str, **kwargs) -> None:
    _refresh_worker_registry()
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
    _refresh_worker_registry()
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
            from crypto_ai.database.connection import task_session
            from crypto_ai.services.task import TaskService
            async with task_session() as session:
                await TaskService(session).update_resource_metrics(task_id, peak_memory_mb, cpu_time_s)
                await session.commit()

        asyncio.run(_write())
    except Exception:
        pass


WORKER_REGISTRY_PREFIX = "gorm:worker:"
WORKER_MODELS_PREFIX = "gorm:worker-models:"
WORKER_GPU_PREFIX = "gorm:worker-gpu:"
WORKER_GPU_NAME_PREFIX = "gorm:worker-gpu-name:"
WORKER_GPU_VRAM_PREFIX = "gorm:worker-gpu-vram:"
WORKER_GPU_COUNT_PREFIX = "gorm:worker-gpu-count:"
WORKER_STARTED_PREFIX = "gorm:worker-started:"
WORKER_REGISTRY_TTL = 7200  # 2 hours – covers long-running simulation tasks
TASK_STOP_PREFIX = "gorm:task-stop:"


# Keeps this worker's registry keys alive while idle. task_prerun refreshes the
# TTL on task start, but a worker idle longer than the TTL would expire and drop
# out of /tasks/workers/list despite being alive. Runs in the worker main
# process (not the pool), so it fires whether idle or busy, and refreshes its
# OWN key (a beat task couldn't guarantee that). 4 beats per TTL tolerates misses.
WORKER_HEARTBEAT_INTERVAL = WORKER_REGISTRY_TTL // 4  # 30 min

_heartbeat_stop = threading.Event()
_heartbeat_thread: threading.Thread | None = None


def _start_registry_heartbeat(hostname: str) -> None:
    """Start a daemon thread that periodically refreshes this worker's registry."""
    global _heartbeat_thread
    if _heartbeat_thread is not None and _heartbeat_thread.is_alive():
        return
    _heartbeat_stop.clear()

    def _beat() -> None:
        # Event.wait returns True on stop (shutdown), False on timeout (beat).
        while not _heartbeat_stop.wait(WORKER_HEARTBEAT_INTERVAL):
            _refresh_worker_registry(hostname)

    _heartbeat_thread = threading.Thread(
        target=_beat, name="worker-registry-heartbeat", daemon=True
    )
    _heartbeat_thread.start()
    logger.info(
        "Worker %s: registry heartbeat started (every %ss, TTL %ss)",
        hostname, WORKER_HEARTBEAT_INTERVAL, WORKER_REGISTRY_TTL,
    )


def _stop_registry_heartbeat() -> None:
    """Signal the heartbeat thread to exit (called on worker shutdown)."""
    _heartbeat_stop.set()


def request_graceful_stop(task_id: str) -> None:
    """Set a Redis flag requesting this task to stop gracefully.

    The running task checks this flag at natural breakpoints (between
    outlets for finetune, between dates for simulation/optimization)
    and exits cleanly after completing the current unit of work.
    """
    r = _get_redis()
    r.setex(f"{TASK_STOP_PREFIX}{task_id}", 86400, "1")


def is_stop_requested(task_id: str) -> bool:
    """Check whether a graceful stop has been requested for this task."""
    r = _get_redis()
    return r.exists(f"{TASK_STOP_PREFIX}{task_id}") > 0


def clear_stop_flag(task_id: str) -> None:
    """Remove the graceful stop flag (e.g. after the task completes)."""
    r = _get_redis()
    r.delete(f"{TASK_STOP_PREFIX}{task_id}")


def _get_redis():
    """Return a Redis client from the broker URL."""
    import redis
    return redis.Redis.from_url(
        settings.celery_broker_url,
        socket_keepalive=True,
        retry_on_timeout=True,
        socket_connect_timeout=5,
    )


def _get_worker_models() -> str:
    """Comma-separated engine slugs this worker can run.

    Explicit via the WORKER_MODELS env var (e.g. single-model remote GPU
    workers like "sundial"); otherwise derived from the engines whose backing
    libraries are actually installed on this worker, so the local worker
    advertises exactly what it can run.
    """
    env = os.environ.get("WORKER_MODELS", "").strip()
    if env:
        return env
    try:
        from crypto_ai.prediction.registry import EngineRegistry

        avail = EngineRegistry().engine_availability()
        return ",".join(sorted(slug for slug, ok in avail.items() if ok))
    except Exception:
        return ""


@worker_ready.connect
def on_worker_ready(sender, **kwargs):
    """Register this worker in Redis and clean up orphaned tasks from previous life."""
    hostname = sender.hostname  # e.g. "celery@RunPod"
    worker_name = hostname.split("@", 1)[-1] if hostname else None

    # Mark any 'started' tasks from our previous life as failed.
    # These tasks were running when the worker died and will never complete.
    if worker_name:
        try:
            from crypto_ai.database.connection import task_session
            from crypto_ai.services.task import TaskService

            async def _cleanup():
                async with task_session() as session:
                    count = await TaskService(session).mark_worker_tasks_failed(worker_name)
                    await session.commit()
                    return count

            count = asyncio.run(_cleanup())
            if count:
                import structlog
                structlog.get_logger().info(
                    "Marked orphaned tasks as failed on startup",
                    worker=worker_name, count=count,
                )
        except Exception:
            pass

    try:
        r = _get_redis()
        r.setex(f"{WORKER_REGISTRY_PREFIX}{hostname}", WORKER_REGISTRY_TTL, "1")
        models = _get_worker_models()
        if models:
            r.setex(f"{WORKER_MODELS_PREFIX}{hostname}", WORKER_REGISTRY_TTL, models)
        gpu_index = os.environ.get("WORKER_GPU_INDEX")
        if gpu_index is not None:
            r.setex(f"{WORKER_GPU_PREFIX}{hostname}", WORKER_REGISTRY_TTL, gpu_index)

        # Store start timestamp for uptime calculation
        import time
        r.setex(f"{WORKER_STARTED_PREFIX}{hostname}", WORKER_REGISTRY_TTL, str(int(time.time())))

        # Store GPU hardware info
        try:
            from crypto_ai.services.resource_estimator import get_system_capacity
            cap = get_system_capacity()
            if cap.gpu_name:
                r.setex(f"{WORKER_GPU_NAME_PREFIX}{hostname}", WORKER_REGISTRY_TTL, cap.gpu_name)
                logger.info(
                    "Worker %s GPU: %s (%s MB)",
                    hostname, cap.gpu_name, cap.gpu_vram_total_mb,
                )
            else:
                logger.warning(
                    "Worker %s: no GPU detected (count=%s)",
                    hostname, cap.gpu_count,
                )
            if cap.gpu_vram_total_mb is not None:
                r.setex(f"{WORKER_GPU_VRAM_PREFIX}{hostname}", WORKER_REGISTRY_TTL, str(int(cap.gpu_vram_total_mb)))
            if cap.gpu_count > 0:
                r.setex(f"{WORKER_GPU_COUNT_PREFIX}{hostname}", WORKER_REGISTRY_TTL, str(cap.gpu_count))
        except Exception:
            logger.exception("Worker %s: failed to detect/store GPU info", hostname)
    except Exception:
        pass

    # Keep the registry keys alive while the worker sits idle between tasks.
    if hostname:
        _start_registry_heartbeat(hostname)


@worker_shutdown.connect
def on_worker_shutdown(sender, **kwargs):
    """Remove this worker from the Redis registry."""
    _stop_registry_heartbeat()
    hostname = sender.hostname
    try:
        r = _get_redis()
        r.delete(f"{WORKER_REGISTRY_PREFIX}{hostname}")
        r.delete(f"{WORKER_MODELS_PREFIX}{hostname}")
        r.delete(f"{WORKER_GPU_PREFIX}{hostname}")
        r.delete(f"{WORKER_GPU_NAME_PREFIX}{hostname}")
        r.delete(f"{WORKER_GPU_VRAM_PREFIX}{hostname}")
        r.delete(f"{WORKER_GPU_COUNT_PREFIX}{hostname}")
        r.delete(f"{WORKER_STARTED_PREFIX}{hostname}")
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
    broker_transport_options={
        "visibility_timeout": 604800,  # 7 days – must exceed longest task (simulations)
        "socket_keepalive": True,
        "retry_on_timeout": True,
    },
    broker_connection_retry_on_startup=True,
    # Solo pool: when the worker is killed mid-task (e.g. revoke with
    # terminate=True), do NOT re-queue the message.  Without this the
    # cancelled task gets redelivered after the container restarts.
    task_reject_on_worker_lost=False,
)
