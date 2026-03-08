"""Simulation API routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.api.deps import TaskServiceDep, get_db
from gorm_ai.schemas.simulation import (
    SimulationRequest,
    SimulationResponse,
    SimulationTaskStatus,
)
from gorm_ai.services.simulation import SimulationService

router = APIRouter()


def get_simulation_service(session: AsyncSession = Depends(get_db)) -> SimulationService:
    return SimulationService(session)


@router.post("", response_model=SimulationResponse, status_code=201)
async def run_simulation(
    data: SimulationRequest,
    service: SimulationService = Depends(get_simulation_service),
) -> SimulationResponse:
    """Run a historic simulation synchronously.

    Suitable for small outlet sets. For large outlet groups use POST /simulations/async.
    """
    try:
        return await service.run_simulation(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/async", response_model=SimulationTaskStatus, status_code=202)
async def run_simulation_async(
    data: SimulationRequest,
    task_service: TaskServiceDep,
) -> SimulationTaskStatus:
    """Queue a simulation as a background Celery task.

    Returns a task ID immediately. Poll GET /simulations/tasks/{task_id} for status.
    """
    from datetime import UTC, datetime

    from gorm_ai.tasks.simulations import run_simulation_task

    task = run_simulation_task.delay(data.model_dump(mode="json"))
    await task_service.create(task.id, "simulation", data.customer_id)

    return SimulationTaskStatus(
        task_id=task.id,
        status="pending",
        progress=0.0,
        message="Simulation task queued",
        created_at=datetime.now(UTC),
    )


@router.get("/tasks/{task_id}", response_model=SimulationTaskStatus)
async def get_simulation_task_status(task_id: str) -> SimulationTaskStatus:
    """Poll the status of an async simulation task."""
    from datetime import UTC, datetime

    from gorm_ai.tasks.celery_app import celery_app

    result = celery_app.AsyncResult(task_id)

    if result.state == "PENDING":
        status, progress, message = "pending", 0.0, "Task is pending"
    elif result.state == "STARTED":
        status, progress, message = "running", 0.5, "Simulation is running"
    elif result.state == "SUCCESS":
        status, progress, message = "completed", 1.0, "Simulation completed"
    elif result.state == "FAILURE":
        error_msg = str(result.result) if result.result else "Task failed"
        status, progress, message = "failed", 0.0, error_msg
    else:
        status, progress, message = "running", 0.5, f"Task state: {result.state}"

    sim_result = None
    completed_at = None
    if result.state == "SUCCESS" and result.result:
        sim_result = SimulationResponse(**result.result)
        completed_at = datetime.now(UTC)

    return SimulationTaskStatus(
        task_id=task_id,
        status=status,
        progress=progress,
        message=message,
        result=sim_result,
        created_at=datetime.now(UTC),
        completed_at=completed_at,
    )
