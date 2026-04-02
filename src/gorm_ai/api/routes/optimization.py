"""Optimization API routes — estimate optimal settings via simulation grid search."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from gorm_ai.api.deps import CustomerConfigurationServiceDep, DbSession, TaskServiceDep
from gorm_ai.database.models.optimization_run import OptimizationRun
from gorm_ai.database.models.task_record import TaskRecord
from gorm_ai.schemas.customer_configuration import CustomerConfigurationUpdate
from gorm_ai.schemas.optimization import (
    ApplySettingsRequest,
    OptimizationRunResponse,
    OptimizeSettingsRequest,
    OptimizeSettingsStatus,
)

router = APIRouter()


_TASK_TO_OPT_STATUS = {"revoked": "cancelled", "failure": "failed"}


async def _sync_run_status(run: OptimizationRun, session: DbSession) -> None:
    """If the linked task was cancelled/failed, mirror that into the optimization run."""
    if run.status not in ("pending", "running"):
        return
    if not run.task_id:
        return
    result = await session.execute(
        select(TaskRecord.status).where(TaskRecord.task_id == run.task_id)
    )
    task_status = result.scalar_one_or_none()
    if task_status and task_status in _TASK_TO_OPT_STATUS:
        run.status = _TASK_TO_OPT_STATUS[task_status]
        await session.flush()


def _run_to_response(run: OptimizationRun) -> OptimizationRunResponse:
    """Convert an OptimizationRun ORM instance to a response schema."""
    return OptimizationRunResponse(
        id=run.id,
        customer_id=run.customer_id,
        name=run.name,
        status=run.status,
        optimize_variation_adjustment=run.optimize_variation_adjustment,
        optimize_eo_methodology=run.optimize_eo_methodology,
        optimize_eo_extrapolation=run.optimize_eo_extrapolation,
        optimize_weekday_profile_correction=run.optimize_weekday_profile_correction,
        simulation_days=run.simulation_days,
        delay=run.delay,
        prediction_engine_id=run.prediction_engine_id,
        outlet_group_id=run.outlet_group_id,
        simulation_from=str(run.simulation_from) if run.simulation_from else None,
        simulation_to=str(run.simulation_to) if run.simulation_to else None,
        total_combinations=run.total_combinations,
        completed_combinations=run.completed_combinations,
        best_combination=run.best_combination,
        best_score=run.best_score,
        results=run.results,
        diagnostics=run.diagnostics,
        created_at=run.created_at.isoformat() if run.created_at else "",
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
    )


@router.get("", response_model=list[OptimizationRunResponse])
async def list_optimization_runs(
    customer_id: str,
    session: DbSession,
) -> list[OptimizationRunResponse]:
    """List optimization runs for a customer, most recent first."""
    result = await session.execute(
        select(OptimizationRun)
        .where(
            OptimizationRun.customer_id == customer_id,
            OptimizationRun.active.is_(True),
        )
        .order_by(OptimizationRun.created_at.desc())
        .limit(20)
    )
    runs = result.scalars().all()
    for run in runs:
        await _sync_run_status(run, session)
    return [_run_to_response(r) for r in runs]


@router.get("/{run_id}", response_model=OptimizationRunResponse)
async def get_optimization_run(
    run_id: str,
    session: DbSession,
) -> OptimizationRunResponse:
    """Get a single optimization run with full results."""
    result = await session.execute(
        select(OptimizationRun).where(
            OptimizationRun.id == run_id,
            OptimizationRun.active.is_(True),
        )
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Optimization run not found")
    await _sync_run_status(run, session)
    return _run_to_response(run)


@router.post("/async", response_model=OptimizeSettingsStatus, status_code=202)
async def start_optimization(
    data: OptimizeSettingsRequest,
    session: DbSession,
    task_service: TaskServiceDep,
) -> OptimizeSettingsStatus:
    """Queue an optimization grid-search as a background Celery task.

    Creates an OptimizationRun record first, then dispatches the Celery task.
    Poll GET /optimization/tasks/{task_id} for status.
    """
    from gorm_ai.tasks.optimization import run_optimization_task

    # Default name if not provided
    name = data.name or f"Optimization {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}"

    # Create the OptimizationRun record
    optimization_run = OptimizationRun(
        customer_id=data.customer_id,
        name=name,
        status="pending",
        optimize_variation_adjustment=data.optimize_variation_adjustment,
        optimize_eo_methodology=data.optimize_eo_methodology,
        optimize_eo_extrapolation=data.optimize_eo_extrapolation,
        optimize_weekday_profile_correction=data.optimize_weekday_profile_correction,
        simulation_days=data.simulation_days,
        delay=data.delay,
        prediction_engine_id=data.prediction_engine_id,
        outlet_group_id=data.outlet_group_id,
    )
    session.add(optimization_run)
    await session.flush()
    await session.refresh(optimization_run)

    # Dispatch the Celery task
    request_data = data.model_dump(mode="json")
    request_data["optimization_run_id"] = optimization_run.id

    dispatch_kwargs: dict = {"args": [request_data]}
    if data.worker:
        dispatch_kwargs["queue"] = data.worker
    task = run_optimization_task.apply_async(**dispatch_kwargs)

    # Update the run with the task ID
    optimization_run.task_id = task.id

    # Create task record for the task dashboard
    await task_service.create(task.id, "optimization", data.customer_id, name=name)

    return OptimizeSettingsStatus(
        task_id=task.id,
        status="pending",
        progress=0,
        progress_message="Optimization task queued",
    )


@router.get("/tasks/{task_id}", response_model=OptimizeSettingsStatus)
async def get_optimization_status(
    task_id: str,
    task_service: TaskServiceDep,
) -> OptimizeSettingsStatus:
    """Poll the status of an async optimization task."""
    record = await task_service.get(task_id)

    result = None
    if record.status == "success":
        # Fetch the Celery result for the full optimization output
        from gorm_ai.tasks.celery_app import celery_app

        celery_result = celery_app.AsyncResult(record.task_id)
        if celery_result.state == "SUCCESS" and celery_result.result:
            result = celery_result.result

    return OptimizeSettingsStatus(
        task_id=record.task_id,
        status=record.status,
        progress=record.progress,
        progress_message=record.progress_message,
        result=result,
    )


@router.post("/{run_id}/apply", status_code=200)
async def apply_optimization_settings(
    run_id: str,
    data: ApplySettingsRequest,
    session: DbSession,
    config_service: CustomerConfigurationServiceDep,
) -> dict:
    """Apply a specific combination of settings to the customer configuration."""
    # Load the OptimizationRun to get customer_id
    result = await session.execute(
        select(OptimizationRun).where(
            OptimizationRun.id == run_id,
            OptimizationRun.active.is_(True),
        )
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Optimization run not found")

    # Build update data from the apply request
    update_data = data.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No settings provided to apply")

    # Check if configuration exists; create if not
    config = await config_service.get_by_customer(run.customer_id)
    if config:
        config_update = CustomerConfigurationUpdate(**update_data)
        await config_service.update(run.customer_id, config_update)
    else:
        from gorm_ai.schemas.customer_configuration import CustomerConfigurationCreate

        config_create = CustomerConfigurationCreate(**update_data)
        await config_service.create(run.customer_id, config_create)

    return {"status": "ok", "applied": update_data, "customer_id": run.customer_id}


@router.post("/{run_id}/resume", response_model=OptimizeSettingsStatus, status_code=202)
async def resume_optimization(
    run_id: str,
    session: DbSession,
    task_service: TaskServiceDep,
    worker: str | None = Query(None),
) -> OptimizeSettingsStatus:
    """Resume a failed or cancelled optimization run.

    Resets the run and dispatches a new Celery task with the same parameters.
    """
    from gorm_ai.tasks.optimization import run_optimization_task

    # Load the OptimizationRun
    result = await session.execute(
        select(OptimizationRun).where(
            OptimizationRun.id == run_id,
            OptimizationRun.active.is_(True),
        )
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Optimization run not found")

    # Sync status from task record first
    await _sync_run_status(run, session)

    if run.status not in ("failed", "cancelled", "stopped"):
        raise HTTPException(
            status_code=400,
            detail="Only failed, cancelled, or stopped optimization runs can be resumed",
        )

    # Mark old TaskRecord as "continued" if it exists
    if run.task_id:
        old_task_result = await session.execute(
            select(TaskRecord).where(TaskRecord.task_id == run.task_id)
        )
        old_record = old_task_result.scalar_one_or_none()
        if old_record:
            old_record.status = "continued"
            old_record.error = "Resumed"
            if not old_record.completed_at:
                old_record.completed_at = datetime.now(UTC)

    # Reset the OptimizationRun for a fresh start
    run.status = "pending"
    run.results = None
    run.best_combination = None
    run.best_score = None
    run.completed_combinations = 0
    run.diagnostics = None
    run.completed_at = None
    await session.flush()

    # Rebuild the request data from the stored run parameters
    request_data = {
        "customer_id": run.customer_id,
        "name": run.name,
        "optimize_variation_adjustment": run.optimize_variation_adjustment,
        "optimize_eo_methodology": run.optimize_eo_methodology,
        "optimize_eo_extrapolation": run.optimize_eo_extrapolation,
        "optimize_weekday_profile_correction": run.optimize_weekday_profile_correction,
        "simulation_days": run.simulation_days,
        "delay": run.delay,
        "prediction_engine_id": run.prediction_engine_id,
        "outlet_group_id": run.outlet_group_id,
        "optimization_run_id": run.id,
    }

    # Determine target worker queue
    target_queue = worker if worker is not None else (
        (await session.execute(
            select(TaskRecord.worker_name).where(TaskRecord.task_id == run.task_id)
        )).scalar_one_or_none() if run.task_id else None
    )

    dispatch_kwargs: dict = {"args": [request_data]}
    if target_queue:
        dispatch_kwargs["queue"] = target_queue
    task = run_optimization_task.apply_async(**dispatch_kwargs)

    # Update the run with the new task ID
    run.task_id = task.id

    # Create task record for the task dashboard
    name = f"Resume: {run.name}" if run.name else "Resume optimization"
    await task_service.create(task.id, "optimization", run.customer_id, name=name)

    return OptimizeSettingsStatus(
        task_id=task.id,
        status="pending",
        progress=0,
        progress_message="Optimization resume task queued",
    )


@router.delete("/{run_id}", status_code=204)
async def delete_optimization_run(
    run_id: str,
    session: DbSession,
) -> None:
    """Soft-delete an optimization run."""
    result = await session.execute(
        select(OptimizationRun).where(
            OptimizationRun.id == run_id,
            OptimizationRun.active.is_(True),
        )
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Optimization run not found")
    run.active = False
