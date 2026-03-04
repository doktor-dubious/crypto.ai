"""Celery application configuration."""

from celery import Celery
from celery.signals import worker_process_init

from gorm_ai.config import get_settings

settings = get_settings()

celery_app = Celery(
    "gorm_ai",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["gorm_ai.tasks.predictions", "gorm_ai.tasks.simulations"],
)

# Celery configuration
@worker_process_init.connect
def init_worker_logging(**kwargs):
    """Configure logging in each Celery worker process."""
    from gorm_ai.logging import configure_logging
    configure_logging()


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
