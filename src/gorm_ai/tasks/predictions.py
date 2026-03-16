"""Prediction Celery tasks."""

import asyncio
from datetime import UTC, date, datetime

from fastapi import HTTPException

from gorm_ai.tasks.celery_app import celery_app


@celery_app.task(bind=True, name="gorm_ai.tasks.predictions.run_prediction_task")
def run_prediction_task(self, request_data: dict) -> dict:
    """
    Run a prediction task asynchronously.

    Args:
        request_data: Prediction request data as dict

    Returns:
        Prediction response as dict
    """
    # Run async code in sync context
    return asyncio.run(_run_prediction_async(self.request.id, request_data))


async def _run_prediction_async(task_id: str, request_data: dict) -> dict:
    """
    Run prediction asynchronously.

    Args:
        task_id: Celery task ID
        request_data: Prediction request data

    Returns:
        Prediction response as dict
    """
    from gorm_ai.database.connection import task_session
    from gorm_ai.schemas.prediction import PredictionRequest
    from gorm_ai.services.prediction import PredictionService
    from gorm_ai.services.task import TaskService

    async with task_session() as session:
        # Guard against redelivery after worker restart.
        # Only run tasks that are still pending – any other status means
        # the task already ran, was cancelled, or failed previously.
        ts = TaskService(session)
        try:
            record = await ts.get(task_id)
            if record.status != "pending":
                return {"skipped": True, "reason": f"task status is {record.status}"}
        except HTTPException:
            return {"skipped": True, "reason": "redelivered task not in DB"}

        await ts.update_status(task_id, "started", started_at=datetime.now(UTC))
        await session.commit()

    async def _on_progress(progress: int, message: str | None = None) -> None:
        from gorm_ai.tasks.celery_app import get_current_metrics
        async with task_session() as session:
            ts = TaskService(session)
            await ts.update_progress(task_id, progress, message)
            peak_mem, cpu_time = get_current_metrics(task_id)
            if peak_mem is not None:
                await ts.update_resource_metrics(task_id, peak_mem, cpu_time)
            await session.commit()

    try:
        # Convert date strings back to date objects
        if isinstance(request_data.get("prediction_from"), str):
            request_data["prediction_from"] = date.fromisoformat(request_data["prediction_from"])
        if isinstance(request_data.get("prediction_to"), str):
            request_data["prediction_to"] = date.fromisoformat(request_data["prediction_to"])

        request = PredictionRequest(**request_data)

        async with task_session() as session:
            service = PredictionService(session)
            result = await service.create_prediction(request, on_progress=_on_progress, task_id=task_id)
            await session.commit()

        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "success", completed_at=datetime.now(UTC)
            )
            await session.commit()

        return result.model_dump(mode="json")

    except Exception as e:
        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "failure", completed_at=datetime.now(UTC), error=str(e)
            )
            await session.commit()
        raise
