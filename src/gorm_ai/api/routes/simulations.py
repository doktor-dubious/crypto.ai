"""Simulation API routes."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.api.deps import TaskServiceDep, get_db
from gorm_ai.schemas.simulation import (
    AccuracyStatsResponse,
    CompletedSimulationListResponse,
    CompletedSimulationResponse,
    DataDumpResponse,
    FilteredOverviewResponse,
    ModelFitResponse,
    SimulationRequest,
    SimulationResponse,
    SimulationTaskStatus,
    ZeroShotResponse,
)
from gorm_ai.services.simulation import SimulationService

router = APIRouter()


def get_simulation_service(session: AsyncSession = Depends(get_db)) -> SimulationService:
    return SimulationService(session)


@router.get("", response_model=CompletedSimulationListResponse)
async def list_simulations(
    customer_id: str,
    limit: int = 500,
    offset: int = 0,
    service: SimulationService = Depends(get_simulation_service),
) -> CompletedSimulationListResponse:
    """List completed simulations for a customer."""
    items, total = await service.list_completed(customer_id, limit=limit, offset=offset)
    return CompletedSimulationListResponse(
        items=[CompletedSimulationResponse(**item) for item in items],
        total=total,
    )


@router.get("/{simulation_id}/zero-shot", response_model=ZeroShotResponse)
async def get_simulation_zero_shot(
    simulation_id: str,
    column: str = "delivered",
    weekdays: list[int] | None = Query(default=None),
    service: SimulationService = Depends(get_simulation_service),
) -> ZeroShotResponse:
    """Get zero-shot accuracy counts for a simulation."""
    result = await service.get_zero_shot(simulation_id, column=column, weekdays=weekdays)
    if result is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return ZeroShotResponse(**result)


@router.get("/{simulation_id}/accuracy-stats", response_model=AccuracyStatsResponse)
async def get_simulation_accuracy_stats(
    simulation_id: str,
    column: str = "delivered",
    weekdays: list[int] | None = Query(default=None),
    service: SimulationService = Depends(get_simulation_service),
) -> AccuracyStatsResponse:
    """Get statistical accuracy metrics (MAE, Bias, RMSE, MAPE, R²) for a simulation."""
    result = await service.get_accuracy_stats(simulation_id, column=column, weekdays=weekdays)
    if result is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return AccuracyStatsResponse(**result)


@router.get("/{simulation_id}/model-fit", response_model=ModelFitResponse)
async def get_simulation_model_fit(
    simulation_id: str,
    outlet_ids: list[str] | None = Query(default=None),
    from_date: date | None = None,
    to_date: date | None = None,
    weekdays: list[int] | None = Query(default=None),
    service: SimulationService = Depends(get_simulation_service),
) -> ModelFitResponse:
    """Get per-date aggregated actual_sale and delivered for a simulation."""
    result = await service.get_model_fit(simulation_id, outlet_ids=outlet_ids, from_date=from_date, to_date=to_date, weekdays=weekdays)
    if result is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return ModelFitResponse(**result)


@router.get("/{simulation_id}/overview", response_model=FilteredOverviewResponse)
async def get_simulation_overview_filtered(
    simulation_id: str,
    column: str = "delivered",
    weekdays: list[int] | None = Query(default=None),
    outlet_ids: list[str] | None = Query(default=None),
    service: SimulationService = Depends(get_simulation_service),
) -> FilteredOverviewResponse:
    """Get overview stats, optionally filtered by weekday/outlet."""
    result = await service.get_overview_filtered(
        simulation_id, column=column, weekdays=weekdays,
        outlet_ids=outlet_ids,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return FilteredOverviewResponse(**result)


@router.get(
    "/{simulation_id}/data-dump",
    response_model=DataDumpResponse,
)
async def get_simulation_data_dump(
    simulation_id: str,
    column: str = "delivered",
    outlet_ids: list[str] | None = Query(default=None),
    weekdays: list[int] | None = Query(default=None),
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = 25,
    offset: int = 0,
    sort_by: str = "date",
    sort_dir: str = "asc",
    search: str | None = None,
    group: str | None = None,
    service: SimulationService = Depends(get_simulation_service),
) -> DataDumpResponse:
    """Get per-row prediction-outlet data for a simulation."""
    result = await service.get_data_dump(
        simulation_id,
        column=column,
        outlet_ids=outlet_ids,
        from_date=from_date,
        to_date=to_date,
        weekdays=weekdays,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_dir=sort_dir,
        search=search,
        group=group,
    )
    if result is None:
        raise HTTPException(
            status_code=404, detail="Simulation not found",
        )
    return DataDumpResponse(**result)


@router.delete("/records/{record_id}", status_code=204)
async def delete_simulation_by_record(
    record_id: str,
    service: SimulationService = Depends(get_simulation_service),
) -> None:
    """Soft-delete a simulation by its TaskRecord id."""
    if not await service.delete_by_record_id(record_id):
        raise HTTPException(status_code=404, detail="Simulation record not found")


@router.delete("/{simulation_id}", status_code=204)
async def delete_simulation(
    simulation_id: str,
    service: SimulationService = Depends(get_simulation_service),
) -> None:
    """Soft-delete a simulation record."""
    if not await service.delete_simulation(simulation_id):
        raise HTTPException(status_code=404, detail="Simulation not found")


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

    dispatch_kwargs: dict = {"args": [data.model_dump(mode="json")]}
    if data.worker:
        dispatch_kwargs["queue"] = data.worker
    task = run_simulation_task.apply_async(**dispatch_kwargs)
    name = data.name or f"Simulation {data.simulation_from} – {data.simulation_to}"
    await task_service.create(task.id, "simulation", data.customer_id, name=name)

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
