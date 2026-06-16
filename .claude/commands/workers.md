---
model: haiku
allowed-tools: Bash
---

Check if Celery workers are running and healthy.

Steps:
1. Run `docker compose ps celery-worker` to check container status.
2. Run `docker compose exec celery-worker celery -A crypto_ai.tasks.celery_app inspect ping --timeout 5` to ping workers.
3. Run `docker compose exec celery-worker celery -A crypto_ai.tasks.celery_app inspect active --timeout 5` to show active tasks.
4. Run `docker compose exec celery-worker celery -A crypto_ai.tasks.celery_app inspect stats --timeout 5 | head -30` to show worker stats (pool size, prefetch count, uptime).

Summarize: which workers responded, how many are alive, any active tasks, and flag any issues (container not running, workers not responding to ping, etc.).
