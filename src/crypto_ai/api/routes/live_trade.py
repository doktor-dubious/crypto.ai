"""Live-trade run endpoints (Trading → Live page): real Binance execution."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import DbSession, LiveTradeServiceDep
from crypto_ai.schemas.live_trade import (
    LiveTradeAccountResponse,
    LiveTradeResponse,
    LiveTradeRunResponse,
)
from crypto_ai.services.binance_trade_client import BinanceTradeError
from crypto_ai.services.live_trade import LiveTradeNotConfiguredError

router = APIRouter()


@router.get("/account", response_model=LiveTradeAccountResponse)
async def account(service: LiveTradeServiceDep) -> LiveTradeAccountResponse:
    """Exchange connectivity, testnet flag and free balances for the header."""
    return await service.account()


@router.get("/runs", response_model=list[LiveTradeRunResponse])
async def list_runs(
    service: LiveTradeServiceDep,
    active: Annotated[bool, Query(description="Only running runs")] = False,
) -> list[LiveTradeRunResponse]:
    return await service.list_runs(active_only=active)


@router.get("/trades", response_model=list[LiveTradeResponse])
async def list_trades(
    service: LiveTradeServiceDep,
    template_id: Annotated[str, Query(description="Strategy template id")],
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
    run_id: Annotated[
        str | None, Query(description="Which of the template's runs; default = current")
    ] = None,
    all_runs: Annotated[
        bool, Query(description="Pool every run of the template instead of one")
    ] = False,
) -> list[LiveTradeResponse]:
    """Live trades for one of the template's runs, newest first. Without
    ``run_id`` this is the current (running, else most recent) run;
    ``all_runs`` pools them all (newest entry first). Each row's ``source`` says
    whether it executed on the testnet or in production."""
    return await service.list_trades(
        template_id, limit=limit, run_id=run_id, all_runs=all_runs
    )


@router.get("/running-templates", response_model=list[str])
async def running_templates(service: LiveTradeServiceDep) -> list[str]:
    return sorted(await service.running_template_ids())


@router.get("/venues", response_model=dict[str, bool])
async def venues() -> dict[str, bool]:
    """Which execution venues have usable credentials. The Strategies page uses
    this to grey out a target rather than offering a button that can only fail —
    testnet and production are separate accounts with separate keys."""
    from crypto_ai.services.binance_trade_client import BinanceTradeClient

    return {
        "testnet": BinanceTradeClient.venue_configured(True),
        "live": BinanceTradeClient.venue_configured(False),
    }


@router.post("/start", response_model=LiveTradeRunResponse)
async def start(
    service: LiveTradeServiceDep,
    session: DbSession,
    template_id: Annotated[str, Query(description="Strategy template id")],
    initial_capital: Annotated[
        float, Query(ge=0, description="Quote budget allocated to this run")
    ] = 100.0,
    testnet: Annotated[
        bool | None,
        Query(description="Venue: true = Binance testnet, false = production"),
    ] = None,
    name: Annotated[
        str | None, Query(max_length=255, description="Name for this run")
    ] = None,
    coin_id: Annotated[
        str | None, Query(description="Override the strategy's saved coin")
    ] = None,
    quote_asset: Annotated[
        str | None, Query(description="Override the strategy's saved quote asset")
    ] = None,
    interval: Annotated[
        str | None, Query(description="Override the strategy's saved interval")
    ] = None,
) -> LiveTradeRunResponse:
    scope = None
    if coin_id or quote_asset or interval:
        scope = {
            k: v
            for k, v in (
                ("coin_id", coin_id), ("quote_asset", quote_asset), ("interval", interval)
            )
            if v
        }
    try:
        run = await service.start(
            template_id,
            initial_capital=initial_capital,
            testnet=testnet,
            scope=scope,
            name=name,
        )
    except LiveTradeNotConfiguredError:
        venue = "testnet" if testnet else "production"
        raise HTTPException(
            status_code=400,
            detail=f"Binance {venue} trading keys not configured "
            f"(BINANCE_TRADE_{'TESTNET' if testnet else 'LIVE'}_API_KEY / _API_SECRET)",
        )
    except BinanceTradeError as exc:
        raise HTTPException(status_code=502, detail=f"Exchange check failed: {exc}")
    if run is None:
        raise HTTPException(status_code=404, detail="Template not found")
    await session.commit()
    # Kick an immediate engine tick (best-effort, same as paper).
    try:
        from crypto_ai.tasks.live_trade import step_live_trades

        step_live_trades.delay()
    except Exception:  # pragma: no cover - broker optional in some contexts
        pass
    runs = await service.list_runs()
    match = next((r for r in runs if r.id == run.id), None)
    if match is None:
        raise HTTPException(status_code=500, detail="Run not found after start")
    return match


@router.post("/stop", response_model=LiveTradeRunResponse | None)
async def stop(
    service: LiveTradeServiceDep,
    session: DbSession,
    run_id: Annotated[str, Query(description="Live-trade run id to stop")],
) -> LiveTradeRunResponse | None:
    """Stop a run. Any open position is liquidated with a market sell; if the
    sell fails the run still stops and the leftover position is surfaced on
    the run's error field."""
    run = await service.stop_run(run_id)
    await session.commit()
    if run is None:
        return None
    runs = await service.list_runs()
    return next((r for r in runs if r.id == run.id), None)
