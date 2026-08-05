"""Paper-trade run endpoints (Paper Trade page): start/stop/list running strategies,
plus sweep management (rotating strategy×coin searches)."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import (
    DbSession,
    PaperSweepServiceDep,
    PaperTradeAnalysisServiceDep,
    PaperTradeServiceDep,
)
from crypto_ai.schemas.paper_sweep import SweepLeaderboard, SweepStatus
from crypto_ai.schemas.paper_trade import (
    BacktestTradeAnalysisRequest,
    PaperTradeAnalysisResponse,
    PaperTradeResponse,
    PaperTradeRunResponse,
    TradeDateRange,
)
from crypto_ai.schemas.paper_trade_analysis import PaperTradeAnalysis

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
    run_id: Annotated[
        str | None, Query(description="Which of the template's runs; default = current")
    ] = None,
    all_runs: Annotated[
        bool, Query(description="Pool every run of the template instead of one")
    ] = False,
) -> list[PaperTradeResponse]:
    """Paper trades for one of the template's runs, newest first. Without
    ``run_id`` this is the current (running, else most recent) run;
    ``all_runs`` pools them all (newest entry first)."""
    return await service.list_trades(
        template_id, limit=limit, run_id=run_id, all_runs=all_runs
    )


@router.get("/analysis", response_model=PaperTradeAnalysis)
async def analysis(
    service: PaperTradeAnalysisServiceDep,
    template_id: Annotated[str, Query(description="Strategy template id")],
    scope: Annotated[
        str, Query(pattern="^(template|run)$", description="Pool all runs, or the current one")
    ] = "template",
    tz_offset_minutes: Annotated[
        int, Query(ge=-840, le=840, description="Shift time-of-day buckets to a local zone")
    ] = 0,
) -> PaperTradeAnalysis:
    """Bucketed performance of a template's closed trades (time of day, weekday,
    side, exit reason) with per-bucket significance."""
    result = await service.analyze(
        template_id, scope=scope, tz_offset_minutes=tz_offset_minutes
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return result


@router.get("/trades/analysis", response_model=PaperTradeAnalysisResponse)
async def trade_analysis(
    service: PaperTradeServiceDep,
    template_id: Annotated[str, Query(description="Strategy template id")],
    trade_seq: Annotated[int, Query(ge=0, description="Trade sequence in the run")],
    run_id: Annotated[
        str | None, Query(description="Run the trade_seq belongs to; default = current")
    ] = None,
) -> PaperTradeAnalysisResponse:
    """Kline snapshot around one trade's entry/exit with signal-bar marks."""
    result = await service.trade_analysis(template_id, trade_seq, run_id=run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return result


@router.post("/trades/backtest-analysis", response_model=PaperTradeAnalysisResponse)
async def backtest_trade_analysis(
    service: PaperTradeServiceDep, req: BacktestTradeAnalysisRequest
) -> PaperTradeAnalysisResponse:
    """Kline snapshot + signal marks for a trade that exists only in a BACKTEST.

    Same payload as ``/trades/analysis``, but keyed on the trade the caller
    drew rather than on a stored row — a backtested round-trip is recomputed
    from the knobs and has no run to look it up in."""
    result = await service.backtest_trade_analysis(req)
    if result is None:
        raise HTTPException(status_code=400, detail="Incomplete scope for analysis")
    return result


@router.get("/trade-range", response_model=TradeDateRange)
async def trade_date_range(
    service: PaperTradeServiceDep,
    template_id: Annotated[str, Query(description="Strategy template id")],
) -> TradeDateRange:
    """First entry / last exit across every run on every venue — the window in
    which this strategy's backtest and its live record are comparable."""
    return await service.trade_date_range(template_id)


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
    name: Annotated[
        str | None, Query(max_length=255, description="Name for this run")
    ] = None,
    coin_id: Annotated[
        str | None, Query(description="Override the template's saved coin")
    ] = None,
    quote_asset: Annotated[
        str | None, Query(description="Override the template's saved quote asset")
    ] = None,
    interval: Annotated[
        str | None, Query(description="Override the template's saved interval")
    ] = None,
) -> PaperTradeRunResponse:
    run = await service.start(
        template_id,
        initial_capital=initial_capital,
        name=name,
        coin_id=coin_id,
        quote_asset=quote_asset,
        interval=interval,
    )
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


# ── Sweeps (rotating strategy×coin searches) ─────────────────────────────────


@router.get("/sweeps", response_model=list[SweepStatus])
async def list_sweeps(service: PaperSweepServiceDep) -> list[SweepStatus]:
    """Every sweep's config + queue progress."""
    return await service.list_sweeps()


@router.get("/sweeps/leaderboard", response_model=SweepLeaderboard)
async def sweep_leaderboard(
    service: PaperSweepServiceDep,
    sweep_id: Annotated[str | None, Query(description="Restrict to one sweep")] = None,
    top: Annotated[int, Query(ge=1, le=100)] = 20,
) -> SweepLeaderboard:
    """Per-template pooled standings + best/worst individual runs."""
    return await service.leaderboard(sweep_id=sweep_id, top=top)


@router.post("/sweeps/rotate")
async def rotate_sweeps(service: PaperSweepServiceDep) -> dict:
    """Run a rotation pass now (the hourly beat task does this automatically)."""
    return await service.rotate()


@router.post("/sweeps/advance")
async def advance_sweep(
    service: PaperSweepServiceDep,
    sweep_id: Annotated[str, Query(description="Sweep whose wave to force-swap")],
) -> dict:
    """Stop ALL the sweep's running runs (regardless of dwell) and start the
    next combos. Destructive-ish — the UI guards it behind a confirm dialog."""
    result = await service.advance(sweep_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Sweep not found")
    return result


@router.post("/sweeps/enabled", response_model=SweepStatus | None)
async def set_sweep_enabled(
    service: PaperSweepServiceDep,
    session: DbSession,
    sweep_id: Annotated[str, Query()],
    enabled: Annotated[bool, Query()],
) -> SweepStatus | None:
    sweep = await service.set_enabled(sweep_id, enabled)
    await session.commit()
    if sweep is None:
        raise HTTPException(status_code=404, detail="Sweep not found")
    return next((s for s in await service.list_sweeps() if s.id == sweep.id), None)


@router.post("/stop", response_model=PaperTradeRunResponse | None)
async def stop(
    service: PaperTradeServiceDep,
    session: DbSession,
    run_id: Annotated[
        str | None, Query(description="Paper-trade run id to stop")
    ] = None,
    template_id: Annotated[
        str | None,
        Query(description="Deprecated: stop the template's current running run"),
    ] = None,
) -> PaperTradeRunResponse | None:
    """Stop a run. ``run_id`` is the contract; ``template_id`` is kept so
    clients from before the per-run API (open tabs, scripts) still stop the
    template's current run instead of 422ing while it keeps trading."""
    if run_id is None and template_id is None:
        raise HTTPException(
            status_code=422, detail="Provide run_id (or legacy template_id)"
        )
    run = (
        await service.stop_run(run_id)
        if run_id is not None
        else await service.stop_template(template_id)
    )
    await session.commit()
    if run is None:
        return None
    runs = await service.list_runs()
    return next((r for r in runs if r.id == run.id), None)
