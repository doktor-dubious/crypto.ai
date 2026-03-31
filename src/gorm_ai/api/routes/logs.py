"""System log viewer endpoints."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

import docker
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.connection import get_session

router = APIRouter()

LOG_DIR = Path("/app/log")
GORM_LOG_FILE = LOG_DIR / "gorm_ai.log"
CLAUDE_LOG_FILE = LOG_DIR / "claude.log"
LLM_LOG_FILE = LOG_DIR / "llm.txt"
FINETUNE_LOG_FILE = LOG_DIR / "finetune.log"

# File-based log sources (not Docker)
FILE_LOG_MAP = {
    "gorm": GORM_LOG_FILE,
    "claude": CLAUDE_LOG_FILE,
    "llm": LLM_LOG_FILE,
    "finetuning": FINETUNE_LOG_FILE,
}

CONTAINER_PREFIX = "gormai"
DOCKER_SERVICE_MAP = {
    "fastapi": "app",
    "celery-worker": "celery-worker",
    "redis": "redis",
    "database": "db",
    "frontend": "frontend",
}

# Matches ISO timestamps like 2026-03-20T08:52:04.743541Z or 2026-03-20T08:52:04.743387218Z
_ISO_TS_RE = re.compile(r"(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?\s*")

# Matches bracket-wrapped ISO timestamps like [2026-03-20T08:52:04Z]
_BRACKET_TS_RE = re.compile(r"\[(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?\]\s*")

# Matches ANSI escape codes
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

# Secondary timestamp patterns found after stripping the Docker timestamp
_SECONDARY_TS_PATTERNS = [
    # Postgres: 2026-03-20 08:52:22.097 UTC [27] LOG:
    re.compile(r"\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\w+\s+\[\d+\]\s+"),
    # Redis: 1:M 20 Mar 2026 08:46:10.164 *
    re.compile(r"\d+:\w\s+\d+\s+\w+\s+\d{4}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\*\s*"),
]


class LogEntry(BaseModel):
    timestamp: str
    message: str


class LogResponse(BaseModel):
    entries: list[LogEntry]
    total_lines: int
    page: int
    page_size: int
    total_pages: int


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _parse_line(raw: str) -> LogEntry:
    """Extract timestamp and clean message from a raw log line."""
    line = _strip_ansi(raw.rstrip("\n"))

    # Try bracket-wrapped timestamp first: [2026-03-20T08:52:04Z]
    m = _BRACKET_TS_RE.match(line)
    if m:
        date_part = m.group(1)
        time_part = m.group(2)
        ts = f"{date_part.replace('-', '.')} {time_part}"
        rest = line[m.end():]
        return LogEntry(timestamp=ts, message=rest.strip())

    # Try bare ISO timestamp
    m = _ISO_TS_RE.match(line)
    if m:
        date_part = m.group(1)  # 2026-03-20
        time_part = m.group(2)  # 08:52:04
        ts = f"{date_part.replace('-', '.')} {time_part}"
        rest = line[m.end():]
    else:
        ts = ""
        rest = line

    # Strip any secondary/duplicate timestamp from Docker-wrapped logs
    for pat in _SECONDARY_TS_PATTERNS:
        m2 = pat.match(rest)
        if m2:
            rest = rest[m2.end():]
            break

    # Strip a second ISO timestamp (celery/frontend logs echo their own ts after Docker's)
    m3 = _ISO_TS_RE.match(rest)
    if m3:
        rest = rest[m3.end():]

    return LogEntry(timestamp=ts, message=rest.strip())


def _read_file_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.readlines()


def _get_docker_logs(service: str, tail: int = 10000) -> list[str]:
    container_name = f"{CONTAINER_PREFIX}-{service}-1"
    try:
        client = docker.from_env()
        container = client.containers.get(container_name)
        log_bytes = container.logs(tail=tail, timestamps=True)
        text = log_bytes.decode("utf-8", errors="replace")
        return text.splitlines()
    except docker.errors.NotFound:
        return [f"Container '{container_name}' not found"]
    except Exception as exc:
        return [f"Error reading logs for {service}: {exc}"]


async def _get_finetune_db_logs(
    session: AsyncSession,
    page: int,
    page_size: int,
    search: str,
    fine_tune_id: str | None,
) -> LogResponse:
    """Read finetune logs from the database."""
    from sqlalchemy import func, select

    from gorm_ai.database.models.finetune_log import FinetuneLog

    query = select(FinetuneLog).where(FinetuneLog.active.is_(True))
    count_query = select(func.count()).select_from(FinetuneLog).where(FinetuneLog.active.is_(True))

    if fine_tune_id:
        query = query.where(FinetuneLog.fine_tune_id == fine_tune_id)
        count_query = count_query.where(FinetuneLog.fine_tune_id == fine_tune_id)

    if search:
        pattern = f"%{search}%"
        query = query.where(FinetuneLog.message.ilike(pattern))
        count_query = count_query.where(FinetuneLog.message.ilike(pattern))

    total = (await session.execute(count_query)).scalar_one()
    total_pages = max(1, (total + page_size - 1) // page_size)

    # Newest first
    query = (
        query
        .order_by(FinetuneLog.logged_at.desc(), FinetuneLog.seq.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await session.execute(query)).scalars().all()

    entries = [
        LogEntry(
            timestamp=row.logged_at.strftime("%Y.%m.%d %H:%M:%S") if row.logged_at else "",
            message=f"[{row.level:<9s}][{row.worker_name or 'local'}] {row.message}",
        )
        for row in rows
    ]

    return LogResponse(
        entries=entries,
        total_lines=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("", response_model=LogResponse)
async def get_logs(
    source: str = Query(
        ..., description="Log source identifier",
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=10, le=1000),
    search: str = Query("", description="Filter lines containing this text"),
    fine_tune_id: str = Query(
        "", description="Filter by fine-tune run ID",
    ),
    session: AsyncSession = Depends(get_session),
) -> LogResponse:
    """Retrieve paginated, parsed log entries, newest first."""

    # Finetune logs come from the database
    if source == "finetuning":
        return await _get_finetune_db_logs(
            session, page, page_size, search,
            fine_tune_id=fine_tune_id or None,
        )

    if source in FILE_LOG_MAP:
        raw_lines = await asyncio.to_thread(_read_file_lines, FILE_LOG_MAP[source])
    elif source in DOCKER_SERVICE_MAP:
        docker_service = DOCKER_SERVICE_MAP[source]
        raw_lines = await asyncio.to_thread(_get_docker_logs, docker_service)
    else:
        return LogResponse(entries=[], total_lines=0, page=1, page_size=page_size, total_pages=0)

    # Parse all lines
    entries = [_parse_line(line) for line in raw_lines]

    # Apply search filter (on message text)
    if search:
        pattern = re.compile(re.escape(search), re.IGNORECASE)
        entries = [e for e in entries if pattern.search(e.message) or pattern.search(e.timestamp)]

    # Reverse for newest first
    entries.reverse()

    total = len(entries)
    total_pages = max(1, (total + page_size - 1) // page_size)
    start = (page - 1) * page_size
    end = start + page_size
    page_entries = entries[start:end]

    return LogResponse(
        entries=page_entries,
        total_lines=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
