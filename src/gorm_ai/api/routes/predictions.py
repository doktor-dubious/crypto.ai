"""Prediction API routes."""

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import PredictionServiceDep, TaskServiceDep
from gorm_ai.schemas.prediction import (
    CompletedPredictionListResponse,
    CompletedPredictionResponse,
    MarginalValueRequest,
    MarginalValueResponse,
    PredictionAnalyticsSummary,
    PredictionEngine,
    PredictionRequest,
    PredictionResponse,
    PredictionTaskStatus,
    TaskStatus,
)
from gorm_ai.tasks.predictions import run_prediction_task

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


@router.get("/{prediction_id}/analytics", response_model=PredictionAnalyticsSummary)
async def get_prediction_analytics(
    prediction_id: str,
    service: PredictionServiceDep,
) -> PredictionAnalyticsSummary:
    """Get aggregate analytics for a completed prediction."""
    data = await service.get_analytics(prediction_id)
    return PredictionAnalyticsSummary(**data)


@router.delete("/{prediction_id}", status_code=204)
async def delete_prediction(
    prediction_id: str,
    service: PredictionServiceDep,
) -> None:
    """Soft-delete a prediction."""
    if not await service.delete_prediction(prediction_id):
        raise HTTPException(status_code=404, detail="Prediction not found")


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

    task = run_prediction_task.delay(data.model_dump(mode="json"))
    await task_service.create(task.id, "prediction", data.customer_id)

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

    from gorm_ai.tasks.celery_app import celery_app

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
