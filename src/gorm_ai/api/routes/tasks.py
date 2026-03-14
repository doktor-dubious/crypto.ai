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
    """
    from gorm_ai.tasks.celery_app import celery_app

    def _ping() -> dict | None:
        return celery_app.control.inspect(timeout=2).ping()

    result = await asyncio.to_thread(_ping)
    if result:
        return WorkerPingResponse(alive=True)

    # Solo pool fallback: check if the worker container is running and healthy.
    container_up = await asyncio.to_thread(_is_worker_container_healthy)
    if container_up:
        return WorkerPingResponse(alive=True)

    # Container is truly down — clean up any started tasks that will never finish.
    await service.mark_stale_tasks_failed(stale_seconds=0)
    return WorkerPingResponse(alive=False)


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
