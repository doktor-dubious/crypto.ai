"""Worker management: enumerate, inspect, and control Celery workers.

Backs the system/workers page. Merges three sources of truth:
  * Docker  — container state/health for LOCAL workers (the app container has
    the docker socket mounted); also lets us start/stop/restart/remove them.
  * Redis   — the worker registry (models, GPU, uptime) for LIVE workers,
    including REMOTE ones (RunPod/Vast) that have no local container.
  * Postgres— per-worker job stats aggregated from ``task_records``.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.task_record import TaskRecord
from crypto_ai.schemas.worker import (
    ManagedWorker,
    WorkerActionResponse,
    WorkerPingResult,
    WorkerStats,
)

logger = logging.getLogger(__name__)

# Compose services that define a worker, with their built-in defaults. crypto.ai
# ships a single default worker (no profile-gated GPU workers), so there are no
# "potential" rows. Keep in sync with docker-compose.yml. The default worker's
# models are derived at runtime from the engines whose libraries are installed,
# so the list here is only a fallback for the (unlikely) "potential" branch.
KNOWN_WORKER_SERVICES: list[dict] = [
    {
        "service": "celery-worker",
        "default_name": "CRYPTO",
        "profile": None,
        "models": [],
    },
]

_RUNNING_STATUSES = ("started", "pending")
_STATUS_ORDER = {"running": 0, "stopped": 1, "potential": 2}


def _profile_for_service(service: str | None) -> str | None:
    for svc in KNOWN_WORKER_SERVICES:
        if svc["service"] == service:
            return svc["profile"]
    return None


# ── Docker helpers (blocking — always call via asyncio.to_thread) ──────────────


def _docker_client():
    import docker  # type: ignore

    return docker.from_env()


def _compose_project(client) -> str:
    """The compose project of THIS (backend) container, so we never touch a
    sibling project's workers (e.g. gormai-celery-worker-*)."""
    try:
        import socket

        me = client.containers.get(socket.gethostname())
        proj = me.labels.get("com.docker.compose.project")
        if proj:
            return proj
    except Exception:
        pass
    return "cryptoai"


def _env_of(container, key: str) -> str | None:
    for entry in container.attrs.get("Config", {}).get("Env", []) or []:
        if entry.startswith(f"{key}="):
            return entry.split("=", 1)[1]
    return None


def _worker_containers(client):
    """All local celery-worker containers (running or stopped) in our project."""
    project = _compose_project(client)
    containers = client.containers.list(
        all=True, filters={"label": f"com.docker.compose.project={project}"}
    )
    return [
        c
        for c in containers
        if c.labels.get("com.docker.compose.service", "").startswith("celery-worker")
    ]


def _list_worker_containers() -> list[dict]:
    try:
        client = _docker_client()
        containers = _worker_containers(client)
    except Exception:
        logger.exception("docker worker enumeration failed")
        return []
    out: list[dict] = []
    for c in containers:
        health = c.attrs.get("State", {}).get("Health", {}).get("Status")
        out.append(
            {
                "service": c.labels.get("com.docker.compose.service", ""),
                "container_name": c.name,
                "status": c.status,  # running | exited | created | paused | ...
                "health": health,  # healthy | unhealthy | starting | None
                "worker_name": _env_of(c, "WORKER_NAME") or "CRYPTO",
                "models": _env_of(c, "WORKER_MODELS") or "",
            }
        )
    return out


def _find_worker_container(name: str):
    client = _docker_client()
    for c in _worker_containers(client):
        if (_env_of(c, "WORKER_NAME") or "CRYPTO") == name:
            return c
    return None


def _read_registry() -> dict[str, dict]:
    """Return ``{short_name: {models, gpu_*, uptime_s}}`` for live registry keys."""
    try:
        import time

        import redis

        from crypto_ai.tasks.celery_app import (
            WORKER_GPU_COUNT_PREFIX,
            WORKER_GPU_NAME_PREFIX,
            WORKER_GPU_PREFIX,
            WORKER_GPU_VRAM_PREFIX,
            WORKER_MODELS_PREFIX,
            WORKER_REGISTRY_PREFIX,
            WORKER_STARTED_PREFIX,
            celery_app,
        )

        r = redis.Redis.from_url(str(celery_app.conf.broker_url))
        out: dict[str, dict] = {}
        for key in r.keys(f"{WORKER_REGISTRY_PREFIX}*"):
            full = key.decode()[len(WORKER_REGISTRY_PREFIX):]  # celery@name
            name = full.split("@", 1)[-1]

            def g(prefix: str) -> str | None:
                v = r.get(f"{prefix}{full}")
                return v.decode() if v else None

            models_raw = g(WORKER_MODELS_PREFIX)
            started_raw = g(WORKER_STARTED_PREFIX)
            gpu_idx = g(WORKER_GPU_PREFIX)
            vram = g(WORKER_GPU_VRAM_PREFIX)
            cnt = g(WORKER_GPU_COUNT_PREFIX)
            out[name] = {
                "models": [s.strip() for s in (models_raw or "").split(",") if s.strip()],
                "gpu_name": g(WORKER_GPU_NAME_PREFIX),
                "gpu_vram_total_mb": int(vram) if vram else None,
                "gpu_count": int(cnt) if cnt else None,
                "gpu_index": int(gpu_idx) if gpu_idx else None,
                "started_ts": int(started_raw) if started_raw else None,
                "uptime_s": (int(time.time()) - int(started_raw)) if started_raw else None,
            }
        return out
    except Exception:
        logger.exception("worker registry read failed")
        return {}


def _ping_names() -> set[str]:
    try:
        from crypto_ai.tasks.celery_app import celery_app

        res = celery_app.control.inspect(timeout=2).ping()
        if res:
            return {k.split("@", 1)[-1] for k in res}
    except Exception:
        pass
    return set()


def _do_action(name: str, action: str) -> tuple[str, str]:
    """Perform a docker action; returns ``(status, message)``. Blocking."""
    try:
        container = _find_worker_container(name)
    except Exception as exc:
        return "error", f"Docker unavailable: {exc}"
    if container is None:
        return "error", (
            f"Worker '{name}' has no local container to control. Profile-gated "
            "workers must first be created via "
            "'docker compose --profile <name> up -d'."
        )
    try:
        if action == "start":
            container.start()
            return "running", f"Worker '{name}' started."
        if action == "stop":
            container.stop()
            return "stopped", f"Worker '{name}' stopped."
        if action == "restart":
            container.restart()
            return "running", f"Worker '{name}' restarted."
        if action == "remove":
            try:
                container.stop()
            except Exception:
                pass
            container.remove(force=True)
            return "removed", f"Worker '{name}' stopped and removed."
        return "error", f"Unknown action '{action}'."
    except Exception as exc:
        return "error", str(exc)


# ── Service ────────────────────────────────────────────────────────────────────


class WorkerManagementService:
    """Read + control Celery workers for the system/workers page."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def _stats_by_worker(self) -> dict[str, WorkerStats]:
        rows = (
            await self.session.execute(
                select(
                    TaskRecord.worker_name,
                    func.count().label("total"),
                    func.count()
                    .filter(TaskRecord.status.in_(_RUNNING_STATUSES))
                    .label("running"),
                    func.count().filter(TaskRecord.status == "success").label("success"),
                    func.count().filter(TaskRecord.status == "failure").label("failure"),
                    func.max(
                        func.coalesce(TaskRecord.completed_at, TaskRecord.updated_at)
                    ).label("last_job_at"),
                    func.avg(TaskRecord.cpu_time_s).label("avg_cpu"),
                    func.avg(TaskRecord.peak_memory_mb).label("avg_mem"),
                )
                .where(TaskRecord.worker_name.is_not(None))
                .group_by(TaskRecord.worker_name)
            )
        ).all()
        out: dict[str, WorkerStats] = {}
        for row in rows:
            out[row.worker_name] = WorkerStats(
                jobs_total=row.total or 0,
                jobs_running=row.running or 0,
                jobs_success=row.success or 0,
                jobs_failure=row.failure or 0,
                last_job_at=row.last_job_at,
                avg_cpu_time_s=round(row.avg_cpu, 1) if row.avg_cpu is not None else None,
                avg_peak_memory_mb=round(row.avg_mem, 1) if row.avg_mem is not None else None,
            )
        return out

    async def _instance_counts(self, started: dict[str, datetime]) -> dict[str, int]:
        """Count jobs each worker has started since its CURRENT process came up.

        ``started`` maps worker name → the process start time (from the Redis
        registry). One query with a per-worker ``(name, started_at >= since)``
        predicate, so each live worker is counted against its own uptime window.
        """
        if not started:
            return {}
        conditions = or_(
            *[
                and_(TaskRecord.worker_name == name, TaskRecord.started_at >= since)
                for name, since in started.items()
            ]
        )
        rows = (
            await self.session.execute(
                select(TaskRecord.worker_name, func.count().label("n"))
                .where(conditions)
                .group_by(TaskRecord.worker_name)
            )
        ).all()
        return {row.worker_name: row.n or 0 for row in rows}

    async def list_workers(self) -> list[ManagedWorker]:
        containers = await asyncio.to_thread(_list_worker_containers)
        registry = await asyncio.to_thread(_read_registry)
        stats = await self._stats_by_worker()

        # Per-instance job counts: jobs started since each live worker's current
        # process start (from the registry's started_ts). Merged into stats.
        started_by_name = {
            name: datetime.fromtimestamp(reg["started_ts"], tz=UTC)
            for name, reg in registry.items()
            if reg.get("started_ts")
        }
        for name, cnt in (await self._instance_counts(started_by_name)).items():
            if name in stats:
                stats[name].jobs_instance = cnt
            else:
                stats[name] = WorkerStats(jobs_instance=cnt)

        by_name: dict[str, ManagedWorker] = {}
        seen_services: set[str] = set()

        # 1. Local containers (running or stopped).
        for c in containers:
            seen_services.add(c["service"])
            name = c["worker_name"]
            running = c["status"] == "running"
            reg = registry.get(name, {})
            models = reg.get("models") or [
                s.strip() for s in c["models"].split(",") if s.strip()
            ]
            by_name[name] = ManagedWorker(
                name=name,
                status="running" if running else "stopped",
                health=c["health"] or ("none" if running else None),
                models=models,
                gpu_name=reg.get("gpu_name"),
                gpu_vram_total_mb=reg.get("gpu_vram_total_mb"),
                gpu_count=reg.get("gpu_count"),
                gpu_index=reg.get("gpu_index"),
                uptime_s=reg.get("uptime_s"),
                container_name=c["container_name"],
                service=c["service"],
                profile=_profile_for_service(c["service"]),
                is_remote=False,
                controllable=True,
                stats=stats.get(name, WorkerStats()),
            )

        # 2. Registry entries with no local container → remote workers.
        for name, reg in registry.items():
            if name in by_name:
                continue
            by_name[name] = ManagedWorker(
                name=name,
                status="running",
                health=None,
                models=reg.get("models") or [],
                gpu_name=reg.get("gpu_name"),
                gpu_vram_total_mb=reg.get("gpu_vram_total_mb"),
                gpu_count=reg.get("gpu_count"),
                gpu_index=reg.get("gpu_index"),
                uptime_s=reg.get("uptime_s"),
                container_name=None,
                service=None,
                profile=None,
                is_remote=True,
                controllable=False,
                stats=stats.get(name, WorkerStats()),
            )

        # 3. Known compose services with no container → potential workers.
        for svc in KNOWN_WORKER_SERVICES:
            if svc["service"] in seen_services:
                continue
            name = svc["default_name"]
            if name in by_name:
                continue
            by_name[name] = ManagedWorker(
                name=name,
                status="potential",
                health=None,
                models=svc["models"],
                container_name=None,
                service=svc["service"],
                profile=svc["profile"],
                is_remote=False,
                controllable=False,
                stats=stats.get(name, WorkerStats()),
            )

        return sorted(
            by_name.values(),
            key=lambda w: (_STATUS_ORDER.get(w.status, 3), w.name.lower()),
        )

    async def get_worker(self, name: str) -> ManagedWorker | None:
        for w in await self.list_workers():
            if w.name == name:
                return w
        return None

    async def ping(self, name: str) -> WorkerPingResult:
        if name in await asyncio.to_thread(_ping_names):
            return WorkerPingResult(name=name, alive=True, source="ping")
        if name in await asyncio.to_thread(_read_registry):
            return WorkerPingResult(name=name, alive=True, source="registry")
        container = await asyncio.to_thread(_find_worker_container, name)
        if container is not None and container.status == "running":
            return WorkerPingResult(name=name, alive=True, source="container")
        return WorkerPingResult(name=name, alive=False, source="none")

    async def action(self, name: str, action: str) -> WorkerActionResponse:
        status, message = await asyncio.to_thread(_do_action, name, action)
        return WorkerActionResponse(name=name, status=status, message=message)
