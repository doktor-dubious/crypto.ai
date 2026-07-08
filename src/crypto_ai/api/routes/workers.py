"""Worker management API routes (system/workers page).

Distinct from the task-scoped `/tasks/workers/*` endpoints (which back the
orchestration worker dropdown and the sidebar liveness check). These endpoints
return the richer running/stopped/potential view and per-worker controls.
"""

from fastapi import APIRouter, HTTPException

from crypto_ai.api.deps import WorkerManagementServiceDep
from crypto_ai.schemas.worker import (
    ManagedWorker,
    WorkerActionResponse,
    WorkerPingResult,
)

router = APIRouter()


@router.get("", response_model=list[ManagedWorker])
async def list_workers(service: WorkerManagementServiceDep) -> list[ManagedWorker]:
    """Running, stopped, and potential (defined-but-not-created) workers."""
    return await service.list_workers()


@router.get("/{name}", response_model=ManagedWorker)
async def get_worker(name: str, service: WorkerManagementServiceDep) -> ManagedWorker:
    worker = await service.get_worker(name)
    if worker is None:
        raise HTTPException(status_code=404, detail=f"Worker '{name}' not found")
    return worker


@router.get("/{name}/ping", response_model=WorkerPingResult)
async def ping_worker(name: str, service: WorkerManagementServiceDep) -> WorkerPingResult:
    return await service.ping(name)


@router.post("/{name}/start", response_model=WorkerActionResponse)
async def start_worker(name: str, service: WorkerManagementServiceDep) -> WorkerActionResponse:
    return await service.action(name, "start")


@router.post("/{name}/stop", response_model=WorkerActionResponse)
async def stop_worker(name: str, service: WorkerManagementServiceDep) -> WorkerActionResponse:
    return await service.action(name, "stop")


@router.post("/{name}/restart", response_model=WorkerActionResponse)
async def restart_worker(name: str, service: WorkerManagementServiceDep) -> WorkerActionResponse:
    return await service.action(name, "restart")


@router.delete("/{name}", response_model=WorkerActionResponse)
async def remove_worker(name: str, service: WorkerManagementServiceDep) -> WorkerActionResponse:
    """Stop and remove the worker's container (recreatable via compose)."""
    return await service.action(name, "remove")
