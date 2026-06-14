"""Celery task package."""

from crypto_ai.tasks.celery_app import celery_app
from crypto_ai.tasks.predictions import run_prediction_task

__all__ = ["celery_app", "run_prediction_task"]
