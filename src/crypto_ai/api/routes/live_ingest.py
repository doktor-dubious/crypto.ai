"""Live kline ingester status + control (backs the Workers-page card).

Start/stop/restart drive the ``live-ingest`` docker container (same mechanism as
the worker controls); status merges container state with the ingester's published
Redis stats.
"""

from typing import Annotated

from fastapi import APIRouter, Query

from crypto_ai.api.deps import LiveIngestControlServiceDep
from crypto_ai.schemas.live_ingest import LiveIngestActionResponse, LiveIngestStatus

router = APIRouter()


@router.get("/status", response_model=LiveIngestStatus)
async def get_status(service: LiveIngestControlServiceDep) -> LiveIngestStatus:
    return await service.status()


@router.post("/start", response_model=LiveIngestActionResponse)
async def start(service: LiveIngestControlServiceDep) -> LiveIngestActionResponse:
    return await service.action("start")


@router.post("/stop", response_model=LiveIngestActionResponse)
async def stop(service: LiveIngestControlServiceDep) -> LiveIngestActionResponse:
    return await service.action("stop")


@router.post("/restart", response_model=LiveIngestActionResponse)
async def restart(service: LiveIngestControlServiceDep) -> LiveIngestActionResponse:
    return await service.action("restart")


@router.post("/mode", response_model=LiveIngestActionResponse)
async def set_mode(
    service: LiveIngestControlServiceDep,
    mode: Annotated[str, Query(description="ws | poll")],
) -> LiveIngestActionResponse:
    """Switch ingestion mode (recreates the container to apply it)."""
    return await service.set_mode(mode)
