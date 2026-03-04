"""Celery application configuration."""

from celery import Celery

from gorm_ai.config import get_settings

settings = get_settings()

celery_app = Celery(
    "gorm_ai",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["gorm_ai.tasks.predictions"],
)

# Celery configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,  # 1 hour max
    task_soft_time_limit=3000,  # 50 minutes soft limit
    worker_prefetch_multiplier=1,
    worker_concurrency=4,
)
