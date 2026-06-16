"""Prediction engine API routes."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from crypto_ai.api.deps import (
    DbSession,
    PredictionEngineParameterServiceDep,
    PredictionEngineServiceDep,
    TaskServiceDep,
)
from crypto_ai.schemas.prediction import (
    PredictionEngineCreate,
    PredictionEngineParameterCreate,
    PredictionEngineParameterResponse,
    PredictionEngineResponse,
    PredictionEngineUpdate,
)


class FinetuneRequest(BaseModel):
    """Schema for fine-tuning request."""
    prediction_engine_id: str
    customer_id: str
    name: str = ""
    description: str | None = None
    outlet_group_id: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    context_length: int = 512
    horizon: int = 64
    epochs: int = 50
    learning_rate: float = 0.001
    batch_size: int = 32
    early_stopping_patience: int = 0
    worker: str | None = None


class FinetuneTaskResponse(BaseModel):
    task_id: str
    status: str
    progress: float
    message: str | None
    created_at: str


class FinetuneCountResponse(BaseModel):
    customer_count: int
    outlet_count: int

router = APIRouter()


@router.get("", response_model=list[PredictionEngineResponse])
async def list_prediction_engines(
    service: PredictionEngineServiceDep,
) -> list[PredictionEngineResponse]:
    """List all prediction engines."""
    engines = await service.list_all()
    return [PredictionEngineResponse.model_validate(e) for e in engines]


@router.post("", response_model=PredictionEngineResponse, status_code=201)
async def create_prediction_engine(
    data: PredictionEngineCreate,
    service: PredictionEngineServiceDep,
) -> PredictionEngineResponse:
    """Create a new prediction engine."""
    engine = await service.create(data)
    return PredictionEngineResponse.model_validate(engine)


@router.get("/{engine_id}", response_model=PredictionEngineResponse)
async def get_prediction_engine(
    engine_id: str,
    service: PredictionEngineServiceDep,
) -> PredictionEngineResponse:
    """Get a prediction engine by ID."""
    engine = await service.get(engine_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Prediction engine not found")
    return PredictionEngineResponse.model_validate(engine)


@router.patch("/{engine_id}", response_model=PredictionEngineResponse)
async def update_prediction_engine(
    engine_id: str,
    data: PredictionEngineUpdate,
    service: PredictionEngineServiceDep,
) -> PredictionEngineResponse:
    """Update a prediction engine."""
    engine = await service.update(engine_id, data)
    if not engine:
        raise HTTPException(status_code=404, detail="Prediction engine not found")
    return PredictionEngineResponse.model_validate(engine)


@router.delete("/{engine_id}", status_code=204)
async def delete_prediction_engine(
    engine_id: str,
    service: PredictionEngineServiceDep,
) -> None:
    """Soft-delete a prediction engine."""
    if not await service.delete(engine_id):
        raise HTTPException(status_code=404, detail="Prediction engine not found")


# ── Parameters ────────────────────────────────────────────────────────────────


@router.get("/{engine_id}/parameters", response_model=list[PredictionEngineParameterResponse])
async def list_engine_parameters(
    engine_id: str,
    service: PredictionEngineParameterServiceDep,
) -> list[PredictionEngineParameterResponse]:
    """List parameters for a prediction engine."""
    params = await service.list_by_engine(engine_id)
    return [PredictionEngineParameterResponse.model_validate(p) for p in params]


@router.post(
    "/{engine_id}/parameters",
    response_model=PredictionEngineParameterResponse,
    status_code=201,
)
async def create_engine_parameter(
    engine_id: str,
    data: PredictionEngineParameterCreate,
    service: PredictionEngineParameterServiceDep,
) -> PredictionEngineParameterResponse:
    """Add a parameter to a prediction engine."""
    param = await service.create(engine_id, data)
    return PredictionEngineParameterResponse.model_validate(param)


@router.post(
    "/parameters/{param_id}/toggle-selected",
    response_model=list[PredictionEngineParameterResponse],
)
async def toggle_parameter_selected(
    param_id: str,
    service: PredictionEngineParameterServiceDep,
) -> list[PredictionEngineParameterResponse]:
    """Toggle selection of a parameter (deselects others in the same group)."""
    param = await service.toggle_selected(param_id)
    if not param:
        raise HTTPException(status_code=404, detail="Parameter not found")
    # Return updated full list for the engine
    params = await service.list_by_engine(param.prediction_engine_id)
    return [
        PredictionEngineParameterResponse.model_validate(p)
        for p in params
    ]


@router.delete("/parameters/{param_id}", status_code=204)
async def delete_engine_parameter(
    param_id: str,
    service: PredictionEngineParameterServiceDep,
) -> None:
    """Soft-delete a prediction engine parameter."""
    if not await service.delete(param_id):
        raise HTTPException(status_code=404, detail="Parameter not found")


# ── Fine-tuning ──────────────────────────────────────────────────────────────


@router.get("/{engine_id}/finetune/models")
async def list_finetune_models(
    engine_id: str,
    engine_service: PredictionEngineServiceDep,
) -> list[str]:
    """List available finetuned model subdirectories for an engine."""
    import os

    engine = await engine_service.get(engine_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Engine not found")
    if not engine.finetuned_model_path:
        return []
    base = engine.finetuned_model_path
    if not os.path.isdir(base):
        return []
    return sorted(
        name
        for name in os.listdir(base)
        if os.path.isdir(os.path.join(base, name))
        and any(
            f.endswith((".safetensors", ".bin"))
            for f in os.listdir(os.path.join(base, name))
        )
    )


@router.delete("/{engine_id}/finetune/reset", status_code=204)
async def reset_finetune(
    engine_id: str,
    engine_service: PredictionEngineServiceDep,
    session: DbSession,
) -> None:
    """Delete all fine-tuned model files and progress records for an engine."""
    import os
    import shutil

    from sqlalchemy import delete as sa_delete

    from crypto_ai.database.models.finetune_progress import FinetuneProgress

    engine = await engine_service.get(engine_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Engine not found")

    # Delete checkpoint files
    base = engine.finetuned_model_path
    if base and os.path.isdir(base):
        shutil.rmtree(base, ignore_errors=True)

    # Delete finetune_progress records for this engine
    await session.execute(
        sa_delete(FinetuneProgress).where(
            FinetuneProgress.engine.in_([engine_id, engine.slug]),
        )
    )
    await session.commit()


@router.get("/{engine_id}/finetune/count", response_model=FinetuneCountResponse)
async def get_finetune_count(
    engine_id: str,
    task_service: TaskServiceDep,
) -> FinetuneCountResponse:
    """Count customers that have been fine-tuned for this engine."""
    from crypto_ai.services.finetune import FinetuneService

    service = FinetuneService(task_service.session)
    counts = await service.count_finetuned(engine_id)
    return FinetuneCountResponse(**counts)


@router.post("/finetune", response_model=FinetuneTaskResponse, status_code=202)
async def start_finetune(
    data: FinetuneRequest,
    task_service: TaskServiceDep,
    session: DbSession,
) -> FinetuneTaskResponse:
    """Start a fine-tuning task asynchronously."""
    from datetime import UTC, datetime

    from crypto_ai.services.fine_tune import FineTuneTrackingService
    from crypto_ai.tasks.finetuning import run_finetune_task

    # Build request data and create FineTune tracking row
    request_data = data.model_dump(mode="json")

    finetune_from = None
    finetune_to = None
    if data.start_date:
        from datetime import date as date_type
        finetune_from = date_type.fromisoformat(data.start_date)
    if data.end_date:
        from datetime import date as date_type
        finetune_to = date_type.fromisoformat(data.end_date)

    ft_service = FineTuneTrackingService(session)
    ft_name = data.name or f"Finetune {data.customer_id[:8]}"
    ft_row = await ft_service.create(
        customer_id=data.customer_id,
        name=ft_name,
        description=data.description,
        prediction_engine_id=data.prediction_engine_id,
        outlet_group_id=data.outlet_group_id,
        finetune_from=finetune_from,
        finetune_to=finetune_to,
        worker_name=data.worker,
    )
    request_data["fine_tune_id"] = ft_row.id

    # Pre-flight capacity check — only meaningful when running locally.
    # When the user targets a specific remote worker queue (e.g. "Vast TimesFM"),
    # the API server's local RAM/GPU is irrelevant; the check would falsely
    # reject GPU jobs because cryptoai-app-1 has no GPU.
    if not data.worker:
        try:
            from crypto_ai.services.resource_estimator import check_capacity, estimate_task

            estimate = estimate_task(
                engine_slug="timesfm",  # finetune currently supports TimesFM and MOIRAI-2
                task_type="finetune",
                num_outlets=100,
                batch_size=data.batch_size,
                context_length=data.context_length,
                epochs=data.epochs,
            )
            cap_check = check_capacity(estimate)
            if not cap_check.can_run:
                raise HTTPException(
                    status_code=422,
                    detail=f"Insufficient resources: {'; '.join(cap_check.warnings)}. "
                           f"{cap_check.recommendation or ''}",
                )
        except HTTPException:
            raise
        except Exception:
            pass  # Don't block finetune if capacity check itself fails

    dispatch_kwargs: dict = {"args": [request_data]}
    if data.worker:
        dispatch_kwargs["queue"] = data.worker

    task = run_finetune_task.apply_async(**dispatch_kwargs)

    # Update the FineTune row with the celery task_id
    ft_row.task_id = task.id
    await session.flush()

    task_name = ft_name
    await task_service.create(
        task.id, "finetune", data.customer_id,
        name=task_name, request_data=request_data,
    )

    await session.commit()

    now = datetime.now(UTC)
    return FinetuneTaskResponse(
        task_id=task.id,
        status="pending",
        progress=0,
        message="Fine-tuning task queued",
        created_at=now.isoformat(),
    )


@router.post("/finetune/resume/{record_id}", response_model=FinetuneTaskResponse, status_code=202)
async def resume_finetune(
    record_id: str,
    task_service: TaskServiceDep,
    worker: str | None = Query(None),
) -> FinetuneTaskResponse:
    """Resume a stopped or failed finetune task.

    Re-dispatches the finetune with the same parameters. The model loads
    from its latest checkpoint so training continues from where it stopped.
    """
    from datetime import UTC, datetime

    from crypto_ai.tasks.finetuning import run_finetune_task

    record = await task_service.get_by_record_id(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Task record not found")
    if record.status not in ("failure", "revoked", "stopped"):
        raise HTTPException(
            status_code=400,
            detail="Only failed, cancelled, or stopped finetune tasks can be resumed",
        )
    if not record.request_data:
        raise HTTPException(
            status_code=400,
            detail="Cannot resume — original task parameters not stored",
        )

    # Determine target worker queue
    target_queue = worker if worker is not None else record.worker_name

    dispatch_kwargs: dict = {"args": [record.request_data]}
    if target_queue:
        dispatch_kwargs["queue"] = target_queue

    task = run_finetune_task.apply_async(**dispatch_kwargs)
    name = f"Resume: {record.name}" if record.name else "Resume finetune"
    await task_service.create(task.id, "finetune", record.customer_id, name=name)

    # Mark old record as continued
    record.status = "continued"
    record.error = "Resumed"
    if not record.completed_at:
        record.completed_at = datetime.now(UTC)

    now = datetime.now(UTC)
    return FinetuneTaskResponse(
        task_id=task.id,
        status="pending",
        progress=0,
        message="Resume task queued",
        created_at=now.isoformat(),
    )
