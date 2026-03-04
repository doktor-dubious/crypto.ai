"""Celery task package."""

from gorm_ai.tasks.celery_app import celery_app
from gorm_ai.tasks.predictions import run_prediction_task

__all__ = ["celery_app", "run_prediction_task"]
