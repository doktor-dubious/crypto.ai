"""Control + monitor the live kline ingester from the app (Workers page card).

Mirrors ``worker_management``: the app container has the docker socket mounted, so
it can start/stop/restart the ``live-ingest`` compose service directly. Live stats
come from the Redis key the ingester publishes (see ``services.live_ingest``).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from crypto_ai.config import get_settings
from crypto_ai.schemas.live_ingest import (
    LiveIngestActionResponse,
    LiveIngestIntervalStat,
    LiveIngestStatus,
)
from crypto_ai.services.live_ingest import STATUS_REDIS_KEY
from crypto_ai.services.worker_management import _compose_project, _docker_client

logger = logging.getLogger(__name__)

LIVE_INGEST_SERVICE = "live-ingest"
VALID_MODES = ("ws", "poll")
# Persisted desired mode override — baked into the container's env at create time,
# so switching mode recreates the container. Falls back to the settings default.
MODE_REDIS_KEY = "live_ingest:mode"


def _redis():
    import redis

    return redis.Redis.from_url(get_settings().redis_url)


def _desired_mode() -> str:
    """Effective mode: the persisted override if set+valid, else the settings default."""
    try:
        raw = _redis().get(MODE_REDIS_KEY)
        mode = raw.decode() if raw else None
        if mode in VALID_MODES:
            return mode
    except Exception:
        pass
    return get_settings().live_ingest_mode


def _persist_mode(mode: str) -> None:
    _redis().set(MODE_REDIS_KEY, mode)


# ── Docker helpers (blocking — always call via asyncio.to_thread) ──────────────


def _find_container():
    client = _docker_client()
    project = _compose_project(client)
    containers = client.containers.list(
        all=True, filters={"label": f"com.docker.compose.project={project}"}
    )
    for c in containers:
        if c.labels.get("com.docker.compose.service") == LIVE_INGEST_SERVICE:
            return c
    return None


def _container_state() -> tuple[str, str | None, str | None]:
    """Return (status, message, container_name): running | stopped | absent | error."""
    try:
        container = _find_container()
    except Exception as exc:
        return "error", f"Docker unavailable: {exc}", None
    if container is None:
        return "absent", "Not created yet — press Start to create and run it.", None
    status = "running" if container.status == "running" else "stopped"
    return status, None, container.name


def _reference_container(client, project):
    """A running sibling to clone image/network/mounts/DB creds from.

    The ingester ships in the same image as the workers (identical Dockerfile) and
    needs the same network + ./src/./log mounts + DB/Redis creds, so we template it
    off the celery-worker (falling back to the app container)."""
    containers = client.containers.list(
        all=True, filters={"label": f"com.docker.compose.project={project}"}
    )
    by_service = {c.labels.get("com.docker.compose.service"): c for c in containers}
    return by_service.get("celery-worker") or by_service.get("app")


def _create_container():
    """Create (and return) the live-ingest container by cloning a sibling's config.

    Lets the app bring the ingester into existence without a terminal — the compose
    service is created on the next `docker compose up -d` too, but this makes the
    Start button work even when it has never been created."""
    client = _docker_client()
    project = _compose_project(client)
    ref = _reference_container(client, project)
    if ref is None:
        raise RuntimeError("no running worker/app container to template the ingester from")

    attrs = ref.attrs
    image = attrs["Config"]["Image"]

    # Carry over DB/Redis creds (the in-container hostnames), add ingester settings.
    env: dict[str, str] = {}
    for entry in attrs["Config"].get("Env", []) or []:
        key, _, val = entry.partition("=")
        if key in ("DATABASE_URL", "REDIS_URL"):
            env[key] = val
    env.setdefault("REDIS_URL", "redis://redis:6379/0")
    s = get_settings()
    env["LIVE_INGEST_MODE"] = _desired_mode()
    env["LIVE_INGEST_INTERVALS"] = s.live_ingest_intervals
    env["LIVE_INGEST_POLL_SECONDS"] = str(s.live_ingest_poll_seconds)

    # Reuse the source + log bind mounts so the container runs the live code.
    volumes: dict[str, dict] = {}
    for bind in attrs["HostConfig"].get("Binds") or []:
        parts = bind.split(":")
        if len(parts) >= 2 and parts[1] in ("/app/src", "/app/log"):
            volumes[parts[0]] = {"bind": parts[1], "mode": parts[2] if len(parts) > 2 else "rw"}

    networks = list(attrs["NetworkSettings"]["Networks"].keys())
    network = networks[0] if networks else None

    labels = {
        "com.docker.compose.project": project,
        "com.docker.compose.service": LIVE_INGEST_SERVICE,
        "com.docker.compose.oneoff": "False",
    }
    return client.containers.create(
        image,
        command=["python", "-m", "crypto_ai.live_ingest_main"],
        name=f"{project}-{LIVE_INGEST_SERVICE}-1",
        environment=env,
        volumes=volumes,
        network=network,
        labels=labels,
        restart_policy={"Name": "unless-stopped"},
        detach=True,
    )


def _do_action(action: str) -> tuple[str, str]:
    """Perform a docker action; returns (status, message). Blocking."""
    try:
        container = _find_container()
    except Exception as exc:
        return "error", f"Docker unavailable: {exc}"
    try:
        # Start with no container = create it first, then start (so the app can
        # bring the ingester into existence without a terminal).
        if container is None:
            if action != "start":
                return "error", "The Live Data Ingester hasn't been created yet."
            container = _create_container()
            container.start()
            return "running", "Live Data Ingester created and started."
        if action == "start":
            container.start()
            return "running", "Live Data Ingester started."
        if action == "stop":
            container.stop()
            return "stopped", "Live Data Ingester stopped."
        if action == "restart":
            container.restart()
            return "running", "Live Data Ingester restarted."
        return "error", f"Unknown action '{action}'."
    except Exception as exc:
        return "error", str(exc)


def _set_mode(mode: str) -> tuple[str, str]:
    """Persist the desired mode and recreate the container so it takes effect.

    Mode is baked into the container's env, so switching means recreate — done
    here while preserving the running/stopped state. If the container doesn't
    exist yet the choice is just stored and applied on the next Start."""
    if mode not in VALID_MODES:
        return "error", f"Invalid mode '{mode}'."
    try:
        _persist_mode(mode)
    except Exception as exc:
        return "error", f"Could not save mode: {exc}"
    try:
        container = _find_container()
    except Exception as exc:
        return "error", f"Docker unavailable: {exc}"
    if container is None:
        return "absent", f"Mode set to {mode}. Press Start to run in {mode} mode."
    try:
        was_running = container.status == "running"
        container.remove(force=True)
        new_container = _create_container()
        if was_running:
            new_container.start()
            return "running", f"Switched to {mode} mode and restarted."
        return "stopped", f"Mode set to {mode}."
    except Exception as exc:
        return "error", str(exc)


def _read_stats() -> dict | None:
    """Read the ingester's published stats snapshot from Redis, or None."""
    try:
        import json

        import redis

        from crypto_ai.config import get_settings

        client = redis.Redis.from_url(get_settings().redis_url)
        raw = client.get(STATUS_REDIS_KEY)
        return json.loads(raw) if raw else None
    except Exception:
        logger.exception("live ingest stats read failed")
        return None


def _dt(ms: int | None) -> datetime | None:
    return datetime.fromtimestamp(ms / 1000, tz=UTC) if ms else None


# ── Service ────────────────────────────────────────────────────────────────────


class LiveIngestControlService:
    """Read status and start/stop/restart the live ingester container."""

    async def status(self) -> LiveIngestStatus:
        container_status, message, container_name = await asyncio.to_thread(_container_state)
        snap = await asyncio.to_thread(_read_stats)
        return self._build(container_status, container_name, message, snap)

    async def action(self, action: str) -> LiveIngestActionResponse:
        status, message = await asyncio.to_thread(_do_action, action)
        return LiveIngestActionResponse(status=status, message=message)

    async def set_mode(self, mode: str) -> LiveIngestActionResponse:
        status, message = await asyncio.to_thread(_set_mode, mode)
        return LiveIngestActionResponse(status=status, message=message)

    def _build(
        self,
        container_status: str,
        container_name: str | None,
        message: str | None,
        snap: dict | None,
    ) -> LiveIngestStatus:
        # Fresh stats exist only while the process is alive (Redis TTL), so their
        # presence + a running container means it's genuinely streaming.
        streaming = container_status == "running" and snap is not None
        if snap is None:
            return LiveIngestStatus(
                container_status=container_status,
                container_name=container_name,
                streaming=False,
                mode=_desired_mode(),
                message=message,
            )

        per_interval = [
            LiveIngestIntervalStat(
                interval=pi["interval"],
                bars=pi["bars"],
                last_bar_at=_dt(pi.get("last_bar_ms")),
            )
            for pi in snap.get("per_interval", [])
        ]
        last_bar_ms = max(
            (pi["last_bar_ms"] for pi in snap.get("per_interval", []) if pi.get("last_bar_ms")),
            default=None,
        )
        started_ms = snap.get("started_ms")
        heartbeat_ms = snap.get("heartbeat_ms")
        uptime_s = (
            int((heartbeat_ms - started_ms) / 1000)
            if started_ms and heartbeat_ms
            else None
        )
        return LiveIngestStatus(
            container_status=container_status,
            container_name=container_name,
            streaming=streaming,
            mode=_desired_mode(),
            started_at=_dt(started_ms),
            uptime_s=uptime_s,
            heartbeat_at=_dt(heartbeat_ms),
            coins=snap.get("coins"),
            intervals=snap.get("intervals", []),
            streams=snap.get("streams"),
            connections_up=snap.get("connections_up"),
            connections_total=snap.get("connections_total"),
            bars_session=snap.get("bars_session"),
            last_bar_at=_dt(last_bar_ms),
            per_interval=per_interval,
            last_error=snap.get("last_error"),
            last_error_at=_dt(snap.get("last_error_ms")),
            message=message,
        )
