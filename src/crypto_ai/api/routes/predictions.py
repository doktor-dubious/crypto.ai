"""Prediction API routes."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import PredictionServiceDep, TaskServiceDep
from crypto_ai.schemas.prediction import (
    CapacityCheckResponse,
    CompletedPredictionListResponse,
    CompletedPredictionResponse,
    MarginalValueRequest,
    MarginalValueResponse,
    MemoryEstimateResponse,
    PadEffectResponse,
    PredictionAnalyticsSummary,
    PredictionComparisonItem,
    PredictionComparisonResponse,
    PredictionDataDumpResponse,
    PredictionEngine,
    PredictionRequest,
    PredictionResponse,
    PredictionTaskStatus,
    ResourceEstimateRequest,
    SystemCapacityResponse,
    TaskStatus,
)
from crypto_ai.tasks.predictions import run_prediction_task

router = APIRouter()


@router.get("", response_model=CompletedPredictionListResponse)
async def list_predictions(
    customer_id: str,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
    service: PredictionServiceDep = ...,
) -> CompletedPredictionListResponse:
    """List completed predictions for a customer."""
    items, total = await service.list_completed(customer_id, search=search, limit=limit, offset=offset)
    return CompletedPredictionListResponse(
        items=[CompletedPredictionResponse(**item) for item in items],
        total=total,
    )


@router.post("/estimate", response_model=CapacityCheckResponse)
async def estimate_task_resources(
    data: ResourceEstimateRequest,
) -> CapacityCheckResponse:
    """Estimate memory requirements and check capacity before submitting a task.

    Returns estimated memory usage, current system capacity, and whether the
    server can handle the workload.
    """
    from crypto_ai.services.resource_estimator import check_capacity, estimate_task

    estimate = estimate_task(
        engine_slug=data.engine,
        task_type=data.task_type,
        num_outlets=data.num_outlets,
        batch_size=data.batch_size,
        horizon=data.horizon,
        context_length=data.context_length,
        num_covariates=data.num_covariates,
        precision=data.precision,
        epochs=data.epochs,
    )
    result = check_capacity(estimate)

    return CapacityCheckResponse(
        can_run=result.can_run,
        estimate=MemoryEstimateResponse(
            model_mb=result.estimate.model_mb,
            inference_mb=result.estimate.inference_mb,
            total_mb=result.estimate.total_mb,
            gpu_required=result.estimate.gpu_required,
            task_type=result.estimate.task_type,
            breakdown=result.estimate.breakdown,
        ),
        capacity=SystemCapacityResponse(
            ram_total_mb=result.capacity.ram_total_mb,
            ram_available_mb=result.capacity.ram_available_mb,
            gpu_vram_total_mb=result.capacity.gpu_vram_total_mb,
            gpu_vram_available_mb=result.capacity.gpu_vram_available_mb,
            gpu_name=result.capacity.gpu_name,
            gpu_index=result.capacity.gpu_index,
            gpu_count=result.capacity.gpu_count,
        ),
        warnings=result.warnings,
        recommendation=result.recommendation,
    )


@router.get("/{prediction_id}/analytics", response_model=PredictionAnalyticsSummary)
async def get_prediction_analytics(
    prediction_id: str,
    service: PredictionServiceDep,
) -> PredictionAnalyticsSummary:
    """Get aggregate analytics for a completed prediction."""
    data = await service.get_analytics(prediction_id)
    return PredictionAnalyticsSummary(**data)


@router.post("/compare", response_model=PredictionComparisonResponse)
async def compare_predictions(
    customer_id: str,
    prediction_ids: list[str],
    service: PredictionServiceDep,
) -> PredictionComparisonResponse:
    """Compare multiple completed predictions side-by-side."""
    items = await service.get_comparison(prediction_ids, customer_id)
    return PredictionComparisonResponse(
        items=[PredictionComparisonItem(**item) for item in items],
    )


@router.delete("/{prediction_id}", status_code=204)
async def delete_prediction(
    prediction_id: str,
    service: PredictionServiceDep,
) -> None:
    """Soft-delete a prediction."""
    if not await service.delete_prediction(prediction_id):
        raise HTTPException(status_code=404, detail="Prediction not found")


@router.get("/{prediction_id}/data-dump", response_model=PredictionDataDumpResponse)
async def get_prediction_data_dump(
    prediction_id: str,
    outlet_ids: list[str] | None = Query(default=None),
    limit: int = 25,
    offset: int = 0,
    sort_by: str = "outlet_name",
    sort_dir: str = "asc",
    search: str | None = None,
    service: PredictionServiceDep = ...,
) -> PredictionDataDumpResponse:
    """Get per-outlet data for a completed prediction."""
    result = await service.get_data_dump(
        prediction_id,
        outlet_ids=outlet_ids,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_dir=sort_dir,
        search=search,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Prediction not found")
    return PredictionDataDumpResponse(**result)


@router.post("", response_model=PredictionResponse, status_code=201)
async def create_prediction(
    data: PredictionRequest,
    service: PredictionServiceDep,
) -> PredictionResponse:
    """Create a prediction synchronously."""
    try:
        prediction = await service.create_prediction(data)
        return prediction
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/async", response_model=PredictionTaskStatus, status_code=202)
async def create_prediction_async(
    data: PredictionRequest,
    task_service: TaskServiceDep,
) -> PredictionTaskStatus:
    """Create a prediction asynchronously using Celery."""
    from datetime import UTC, datetime

    # Pre-flight capacity check
    from crypto_ai.services.resource_estimator import check_capacity, estimate_task

    engine_slug = data.engine.value if data.engine else "statistical"
    horizon = (data.prediction_to - data.prediction_from).days + 1
    estimate = estimate_task(
        engine_slug=engine_slug, task_type="prediction",
        num_outlets=len(data.outlet_ids) if data.outlet_ids else 100,
        batch_size=data.batch_size, horizon=horizon,
        num_covariates=7 + (3 if data.use_financials else 0) + (2 if data.use_pad else 0),
    )
    cap_check = check_capacity(estimate)
    if not cap_check.can_run:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient resources: {'; '.join(cap_check.warnings)}. "
                   f"{cap_check.recommendation or ''}",
        )

    dispatch_kwargs: dict = {"args": [data.model_dump(mode="json")]}
    if data.worker:
        dispatch_kwargs["queue"] = data.worker
    task = run_prediction_task.apply_async(**dispatch_kwargs)
    prediction_name = f"{data.prediction_from} → {data.prediction_to}"
    await task_service.create(task.id, "prediction", data.customer_id, name=prediction_name)

    return PredictionTaskStatus(
        task_id=task.id,
        status=TaskStatus.PENDING,
        progress=0.0,
        message="Prediction task queued",
        created_at=datetime.now(UTC),
    )


@router.get("/tasks/{task_id}", response_model=PredictionTaskStatus)
async def get_prediction_task_status(
    task_id: str,
) -> PredictionTaskStatus:
    """Get the status of a prediction task."""
    from datetime import UTC, datetime

    from crypto_ai.tasks.celery_app import celery_app

    result = celery_app.AsyncResult(task_id)

    if result.state == "PENDING":
        status = TaskStatus.PENDING
        progress = 0.0
        message = "Task is pending"
    elif result.state == "STARTED":
        status = TaskStatus.RUNNING
        progress = 0.5
        message = "Task is running"
    elif result.state == "SUCCESS":
        status = TaskStatus.COMPLETED
        progress = 1.0
        message = "Task completed successfully"
    elif result.state == "FAILURE":
        status = TaskStatus.FAILED
        progress = 0.0
        message = str(result.result) if result.result else "Task failed"
    else:
        status = TaskStatus.RUNNING
        progress = 0.5
        message = f"Task state: {result.state}"

    prediction_result = None
    completed_at = None

    if result.state == "SUCCESS" and result.result:
        prediction_result = PredictionResponse(**result.result)
        completed_at = datetime.now(UTC)

    return PredictionTaskStatus(
        task_id=task_id,
        status=status,
        progress=progress,
        message=message,
        result=prediction_result,
        created_at=datetime.now(UTC),
        completed_at=completed_at,
    )


@router.post("/marginal-value", response_model=MarginalValueResponse)
async def get_marginal_value(
    data: MarginalValueRequest,
    service: PredictionServiceDep,
) -> MarginalValueResponse:
    """Rank outlets by P(demand > delivered) — which outlet benefits most from one extra copy.

    Requires existing prediction_outlet rows for the given date. Outlets with no
    prediction are listed in `missing_outlets`.
    """
    return await service.get_marginal_value(data)


@router.get("/engines", response_model=list[PredictionEngine])
async def list_engines(
    service: PredictionServiceDep,
) -> list[PredictionEngine]:
    """List available prediction engines."""
    return service.get_available_engines()


@router.get("/engines/availability")
async def engine_availability(service: PredictionServiceDep) -> dict[str, bool]:
    """Map each engine slug → whether its backing library is installed on this server."""
    return service.get_engine_availability()


@router.get("/pad-effect", response_model=PadEffectResponse)
async def get_pad_effect(
    customer_id: str,
    outlet_id: str,
    pad_date: date,
    n_baselines: int = 8,
    service: PredictionServiceDep = ...,
) -> PadEffectResponse:
    """Estimate the demand effect of a PAD event for one outlet.

    Compares the model's prediction on pad_date to the average prediction
    across the n_baselines most recent non-PAD days with the same weekday.
    """
    result = await service.pad_effect(
        customer_id=customer_id,
        outlet_id=outlet_id,
        pad_date=pad_date,
        n_baselines=n_baselines,
    )
    return PadEffectResponse(**result)
