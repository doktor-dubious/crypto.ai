---
model: haiku
allowed-tools: Bash
---

Start the full application stack in Docker.

Steps:
1. Run `docker compose build` to build/rebuild images.
2. Run `docker compose up -d` to start all services in detached mode.
3. Run `docker compose ps` to show the status of all services.
4. If any service is not running/healthy, run `docker compose logs <service>` to show its logs.

Services: db (TimescaleDB), redis, app (FastAPI), celery-worker, frontend (Next.js).
Access: frontend at http://localhost:3000, API at http://localhost:8000.
