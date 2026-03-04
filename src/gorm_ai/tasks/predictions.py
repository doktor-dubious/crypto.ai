"""Prediction Celery tasks."""

import asyncio
from datetime import date

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
    return asyncio.run(_run_prediction_async(request_data))


async def _run_prediction_async(request_data: dict) -> dict:
    """
    Run prediction asynchronously.

    Args:
        request_data: Prediction request data

    Returns:
        Prediction response as dict
    """
    from gorm_ai.database.connection import async_session_factory
    from gorm_ai.schemas.prediction import PredictionRequest
    from gorm_ai.services.prediction import PredictionService

    # Convert date strings back to date objects
    if isinstance(request_data.get("prediction_from"), str):
        request_data["prediction_from"] = date.fromisoformat(request_data["prediction_from"])
    if isinstance(request_data.get("prediction_to"), str):
        request_data["prediction_to"] = date.fromisoformat(request_data["prediction_to"])

    request = PredictionRequest(**request_data)

    async with async_session_factory() as session:
        service = PredictionService(session)
        result = await service.create_prediction(request)
        await session.commit()

    return result.model_dump(mode="json")
