"""Paper-trade run endpoints (Paper Trade page): start/stop/list running strategies."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import DbSession, PaperTradeServiceDep
from crypto_ai.schemas.paper_trade import PaperTradeResponse, PaperTradeRunResponse

router = APIRouter()


@router.get("/runs", response_model=list[PaperTradeRunResponse])
async def list_runs(
    service: PaperTradeServiceDep,
    active: Annotated[bool, Query(description="Only running runs")] = False,
) -> list[PaperTradeRunResponse]:
    return await service.list_runs(active_only=active)


@router.get("/trades", response_model=list[PaperTradeResponse])
async def list_trades(
    service: PaperTradeServiceDep,
    template_id: Annotated[str, Query(description="Strategy template id")],
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
) -> list[PaperTradeResponse]:
    """Paper trades for the template's current (or most recent) run, newest first."""
    return await service.list_trades(template_id, limit=limit)


@router.get("/running-templates", response_model=list[str])
async def running_templates(service: PaperTradeServiceDep) -> list[str]:
    """Template ids that currently have a running run (drives the table toggle)."""
    return sorted(await service.running_template_ids())


@router.post("/start", response_model=PaperTradeRunResponse)
async def start(
    service: PaperTradeServiceDep,
    session: DbSession,
    template_id: Annotated[str, Query(description="Strategy template id")],
    initial_capital: Annotated[
        float, Query(ge=0, description="Paper investment in quote currency")
    ] = 100.0,
) -> PaperTradeRunResponse:
    run = await service.start(template_id, initial_capital=initial_capital)
    if run is None:
        raise HTTPException(status_code=404, detail="Template not found")
    await session.commit()
    # Kick an immediate engine step so the card shows a baseline without waiting
    # for the next beat tick (best-effort — the periodic task is the source of truth).
    try:
        from crypto_ai.tasks.paper_trade import step_paper_trades

        step_paper_trades.delay()
    except Exception:  # pragma: no cover - broker optional in some contexts
        pass
    runs = await service.list_runs()
    match = next((r for r in runs if r.id == run.id), None)
    if match is None:
        raise HTTPException(status_code=500, detail="Run not found after start")
    return match


@router.post("/stop", response_model=PaperTradeRunResponse | None)
async def stop(
    service: PaperTradeServiceDep,
    session: DbSession,
    template_id: Annotated[str, Query(description="Strategy template id")],
) -> PaperTradeRunResponse | None:
    run = await service.stop(template_id)
    await session.commit()
    if run is None:
        return None
    runs = await service.list_runs()
    return next((r for r in runs if r.id == run.id), None)
