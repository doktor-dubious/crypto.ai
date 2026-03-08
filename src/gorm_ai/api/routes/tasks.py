"""Task record API routes."""

from fastapi import APIRouter, HTTPException, Query

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
    """Return currently executing tasks from live Celery workers."""
    return await service.get_active()


@router.get("/pending", response_model=list[CeleryWorkerTask])
async def get_pending_tasks(service: TaskServiceDep) -> list[CeleryWorkerTask]:
    """Return queued-but-not-started tasks from live Celery workers."""
    return await service.get_pending()


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
