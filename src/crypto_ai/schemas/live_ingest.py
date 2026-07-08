"""Schemas for the live kline ingester status/control API (Workers page card)."""

from datetime import datetime

from pydantic import BaseModel


class LiveIngestIntervalStat(BaseModel):
    """Per-interval ingestion counters for the current ingester session."""

    interval: str
    bars: int
    last_bar_at: datetime | None = None


class LiveIngestStatus(BaseModel):
    """Merged view of the live-ingest container state and its published stats."""

    # Docker container lifecycle: running | stopped | absent | error.
    container_status: str
    # The live-ingest container's name, if it has been created.
    container_name: str | None = None
    # True when the container is running AND publishing a fresh heartbeat.
    streaming: bool
    mode: str | None = None
    started_at: datetime | None = None
    uptime_s: int | None = None
    heartbeat_at: datetime | None = None
    coins: int | None = None
    intervals: list[str] = []
    streams: int | None = None
    connections_up: int | None = None
    connections_total: int | None = None
    bars_session: int | None = None
    last_bar_at: datetime | None = None
    per_interval: list[LiveIngestIntervalStat] = []
    last_error: str | None = None
    last_error_at: datetime | None = None
    # Human-readable note (e.g. why there are no stats yet).
    message: str | None = None


class LiveIngestActionResponse(BaseModel):
    status: str
    message: str
