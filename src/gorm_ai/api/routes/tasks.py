"""Task record API routes."""

import asyncio

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from gorm_ai.api.deps import TaskServiceDep
from gorm_ai.schemas.task import CeleryWorkerTask, TaskListResponse, TaskRecordResponse

router = APIRouter()


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    service: TaskServiceDep,
    customer_id: str | None = Query(default=None),
    type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> TaskListResponse:
    """List task records from the database with optional filters."""
    # Auto-clean pending tasks that were never picked up (e.g. worker
    # restarted with --purge).  Runs cheaply on every poll — a single
    # UPDATE … WHERE created_at < now()-5min that is a no-op most of
    # the time.
    await service.mark_stale_pending_revoked()

    items, total = await service.list_tasks(
        customer_id=customer_id,
        task_type=type,
        status=status,
        limit=limit,
        offset=offset,
    )
    return TaskListResponse(
        items=[TaskRecordResponse.model_validate(item) for item in items],
        total=total,
    )


@router.get("/active", response_model=list[CeleryWorkerTask])
async def get_active_tasks(service: TaskServiceDep) -> list[CeleryWorkerTask]:
    """Return currently executing tasks from live Celery workers.

    Falls back to DB records when the solo pool blocks inspect
    (worker is busy executing a task and can't respond).
    """
    tasks = await service.get_active()
    if not tasks:
        tasks = await service.get_active_from_db()
    return tasks


@router.get("/pending", response_model=list[CeleryWorkerTask])
async def get_pending_tasks(service: TaskServiceDep) -> list[CeleryWorkerTask]:
    """Return queued-but-not-started tasks from live Celery workers."""
    return await service.get_pending()


class WorkerPingResponse(BaseModel):
    alive: bool


@router.get("/workers/ping", response_model=WorkerPingResponse)
async def ping_workers(service: TaskServiceDep) -> WorkerPingResponse:
    """Ping Celery workers. Returns alive=True if at least one worker responds.

    With --pool=solo the worker can't respond to inspect while running a task.
    We fall back to checking whether the Docker container is running, which is
    reliable regardless of what the solo pool is doing.

    Also detects orphaned tasks: if a worker (e.g. a RunPod instance) has died
    but other workers are still alive, tasks from the dead worker are marked
    as failed.
    """
    from gorm_ai.tasks.celery_app import celery_app

    def _ping() -> dict | None:
        return celery_app.control.inspect(timeout=2).ping()

    result = await asyncio.to_thread(_ping)

    # Collect the short names of workers that responded to ping
    # Keys are like "celery@local", "celery@runpod-gpu"
    alive_workers: set[str] = set()
    if result:
        for key in result:
            alive_workers.add(key.split("@", 1)[-1])

    # Solo pool fallback: the local worker can't respond to ping while busy,
    # so check if its Docker container is running.
    local_name = await asyncio.to_thread(_get_local_worker_name)
    if local_name not in alive_workers:
        container_up = await asyncio.to_thread(_is_worker_container_healthy)
        if container_up:
            alive_workers.add(local_name)

    if not alive_workers:
        # No workers alive at all — mark everything started as failed.
        await service.mark_stale_tasks_failed(stale_seconds=0)
        return WorkerPingResponse(alive=False)

    # Some workers are alive but others may have died (e.g. terminated RunPod).
    # Mark tasks from dead workers as failed.
    await service.mark_orphaned_worker_tasks_failed(alive_workers)

    return WorkerPingResponse(alive=True)


def _get_local_worker_name() -> str:
    """Return the WORKER_NAME of the local celery-worker container, or 'local'."""
    try:
        import docker  # type: ignore
        client = docker.from_env()
        containers = client.containers.list(
            all=True,
            filters={"label": "com.docker.compose.service=celery-worker"},
        )
        if containers:
            env_list = containers[0].attrs.get("Config", {}).get("Env", [])
            for entry in env_list:
                if entry.startswith("WORKER_NAME="):
                    return entry.split("=", 1)[1]
    except Exception:
        pass
    return "local"


def _is_worker_container_healthy() -> bool:
    """Check if the celery-worker Docker container is running and healthy.

    Returns True if the container is running AND either has no healthcheck
    configured or its health status is 'healthy'. Returns False if the
    container is unhealthy, not running, or not found.
    """
    try:
        import docker  # type: ignore
        client = docker.from_env()
        containers = client.containers.list(
            all=True,
            filters={"label": "com.docker.compose.service=celery-worker"},
        )
        if not containers:
            return False
        container = containers[0]
        if container.status != "running":
            return False
        health = container.attrs.get("State", {}).get("Health", {}).get("Status")
        # No healthcheck configured → trust running status; otherwise require healthy
        return health is None or health == "healthy"
    except Exception:
        return False


@router.get("/workers/list", response_model=list[str])
async def list_workers() -> list[str]:
    """Return names of registered Celery workers (including busy ones)."""
    from gorm_ai.tasks.celery_app import WORKER_REGISTRY_PREFIX, celery_app

    def _get_workers() -> list[str]:
        import redis

        # Primary source: Redis registry (works even when solo-pool workers
        # are busy and can't respond to inspect commands).
        r = redis.Redis.from_url(str(celery_app.conf.broker_url))
        keys = r.keys(f"{WORKER_REGISTRY_PREFIX}*")
        prefix_len = len(WORKER_REGISTRY_PREFIX)
        registered = {k.decode()[prefix_len:] for k in keys}

        # Fallback: also include workers that respond to ping (covers
        # workers that haven't been restarted with the new registration).
        try:
            ping_result = celery_app.control.inspect(timeout=2).ping()
            if ping_result:
                registered.update(ping_result.keys())
        except Exception:
            pass

        # Worker keys are like "celery@GORM" — extract the name after @
        return sorted(key.split("@", 1)[-1] for key in registered)

    return await asyncio.to_thread(_get_workers)


@router.post("/workers/restart", status_code=204)
async def restart_workers() -> None:
    """Restart the Celery worker container via Docker."""
    def _restart() -> None:
        import docker  # type: ignore
        client = docker.from_env()
        containers = client.containers.list(
            all=True,
            filters={"label": "com.docker.compose.service=celery-worker"},
        )
        if not containers:
            raise HTTPException(status_code=503, detail="celery-worker container not found")
        for container in containers:
            container.restart()

    try:
        await asyncio.to_thread(_restart)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/{task_id}", response_model=TaskRecordResponse)
async def get_task(task_id: str, service: TaskServiceDep) -> TaskRecordResponse:
    """Get a task record by Celery task ID."""
    record = await service.get(task_id)
    return TaskRecordResponse.model_validate(record)


@router.delete("/{task_id}", status_code=204)
async def cancel_task(task_id: str, service: TaskServiceDep) -> None:
    """Revoke a Celery task and mark its record as revoked."""
    try:
        await service.get(task_id)
    except HTTPException:
        raise
    await service.cancel(task_id)
