"""Schemas for the worker-management page (system/workers)."""

from datetime import datetime

from pydantic import BaseModel


class WorkerStats(BaseModel):
    jobs_total: int = 0
    jobs_instance: int = 0  # jobs started since the current process came up
    jobs_running: int = 0
    jobs_success: int = 0
    jobs_failure: int = 0
    last_job_at: datetime | None = None
    avg_cpu_time_s: float | None = None
    avg_peak_memory_mb: float | None = None


class ManagedWorker(BaseModel):
    name: str
    status: str  # running | stopped | potential
    health: str | None = None  # docker health: healthy/unhealthy/starting/none
    models: list[str] = []
    gpu_name: str | None = None
    gpu_vram_total_mb: int | None = None
    gpu_count: int | None = None
    gpu_index: int | None = None
    uptime_s: int | None = None
    container_name: str | None = None
    service: str | None = None
    profile: str | None = None
    is_remote: bool = False
    controllable: bool = False
    stats: WorkerStats = WorkerStats()


class WorkerActionResponse(BaseModel):
    name: str
    status: str  # running | stopped | removed | error
    message: str


class WorkerPingResult(BaseModel):
    name: str
    alive: bool
    source: str | None = None  # ping | registry | container | none
