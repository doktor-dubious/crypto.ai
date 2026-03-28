"""Task record Pydantic schemas."""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class TaskType(StrEnum):
    """Async task type."""

    PREDICTION = "prediction"
    SIMULATION = "simulation"


class TaskStatus(StrEnum):
    """Async task status."""

    PENDING = "pending"
    STARTED = "started"
    SUCCESS = "success"
    FAILURE = "failure"
    REVOKED = "revoked"
    CONTINUED = "continued"
    STOPPED = "stopped"


class TaskRecordResponse(BaseModel):
    """Response schema for a task record."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    type: str
    status: str
    customer_id: str | None
    started_at: datetime | None
    completed_at: datetime | None
    error: str | None
    progress: int = 0
    progress_message: str | None = None
    name: str | None = None
    worker_name: str | None = None
    peak_memory_mb: float | None = None
    cpu_time_s: float | None = None
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    """Paginated list of task records."""

    items: list[TaskRecordResponse]
    total: int


class CeleryWorkerTask(BaseModel):
    """Lightweight schema for a live Celery worker task."""

    task_id: str
    name: str
    worker: str
    args: list
