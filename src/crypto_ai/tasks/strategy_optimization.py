"""Celery tasks that run a strategy optimization.

Split into a parent that plans and children that execute ONE market each. The
parent expands the grid, writes the total, and fans out; every child builds its
market's context, scores its combos, writes the results and bumps ``n_done``. The
last child to finish flips the status.

Chunking per market is not incidental. The worker runs at concurrency 4 with
``step_paper_trades`` and ``step_live_trades`` on 60-second beats — one long task
holding a slot for hours would starve live trading. Per-market children keep each
unit to seconds-to-minutes, so slots free up constantly and progress is real
rather than interpolated.
"""

import asyncio
from datetime import UTC, datetime

import structlog
from sqlalchemy import select, update

from crypto_ai.database.connection import task_session
from crypto_ai.database.models.strategy_optimization import (
    StrategyOptimization,
    StrategyOptimizationResult,
)
from crypto_ai.services.strategy_optimization import StrategyOptimizationService
from crypto_ai.services.strategy_optimization_grid import expand, group_by_market
from crypto_ai.services.strategy_optimization_runner import OptimizationRunner
from crypto_ai.tasks.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(name="crypto_ai.tasks.strategy_optimization.run_optimization")
def run_optimization(optimization_id: str) -> dict:
    """Plan the grid and fan out one child per market."""
    return asyncio.run(_plan(optimization_id))


async def _plan(optimization_id: str) -> dict:
    async with task_session() as session:
        opt = await session.get(StrategyOptimization, optimization_id)
        if opt is None:
            return {"error": "optimization not found"}
        service = StrategyOptimizationService(session)
        try:
            coins = await service.resolve_coins(opt.spec.get("coins", {}), opt.seed)
        except Exception as exc:
            opt.status = "error"
            opt.error = str(exc)[:500]
            opt.finished_at = datetime.now(UTC)
            await session.commit()
            return {"error": str(exc)}

        # Freeze the resolved coin universe onto the spec. Children re-expand
        # the grid themselves, and resolving again against live DB state (a
        # coin toggled inactive, a group edited mid-run) would give them a
        # different expansion than the one n_total was computed from — leaving
        # the counters permanently short of (or past) the frozen total.
        #
        # "draw" freezes the SAMPLING ALGORITHM the same way: expand() only
        # index-samples huge cartesians when the spec says the plan was drawn
        # that way, so children of an optimization planned by older code (no
        # stamp) keep reproducing its shuffle draw — otherwise a deploy mid-run
        # would strand the counters short of n_total forever.
        opt.spec = {**opt.spec, "resolved_coins": [list(c) for c in coins], "draw": 2}

        intervals = list(opt.spec.get("intervals") or [])
        combos, cartesian, sampled = expand(
            opt.spec, coins, intervals,
            max_combos=opt.max_combos, seed=opt.seed,
            baseline_params=opt.spec.get("baseline_params") or None,
        )
        groups = group_by_market(combos)

        opt.n_cartesian = cartesian
        opt.sampled = sampled
        opt.n_total = len(combos)
        opt.n_done = 0
        opt.n_skipped = 0
        opt.status = "running" if combos else "error"
        opt.started_at = datetime.now(UTC)
        opt.error = None
        if not combos:
            # Never "success". A grid that expands to nothing has a spec that
            # can't be honoured — no coins resolved, or no timeframes — and
            # reporting that as a completed search with no findings is the most
            # misleading thing this task could do.
            opt.error = "This grid expands to no combos — check the coins and timeframes."
            opt.finished_at = opt.started_at
        await session.commit()

    for (coin_id, quote, interval) in groups:
        run_optimization_market.delay(optimization_id, coin_id, quote, interval)
    log.info(
        "optimization.planned",
        optimization_id=optimization_id, combos=len(combos), markets=len(groups),
        cartesian=cartesian, sampled=sampled,
    )
    return {"combos": len(combos), "markets": len(groups), "sampled": sampled}


@celery_app.task(
    name="crypto_ai.tasks.strategy_optimization.run_optimization_market",
    # A market is bounded work (one context + its combos); if it can't finish in
    # 30 minutes something is wrong with the data, not the budget.
    time_limit=1800,
    soft_time_limit=1740,
)
def run_optimization_market(
    optimization_id: str, coin_id: str, quote_asset: str, interval: str
) -> dict:
    """Score every combo of one market and record them."""
    return asyncio.run(_run_market(optimization_id, coin_id, quote_asset, interval))


async def _run_market(
    optimization_id: str, coin_id: str, quote_asset: str, interval: str
) -> dict:
    async with task_session() as session:
        opt = await session.get(StrategyOptimization, optimization_id)
        if opt is None or opt.status not in ("running", "pending"):
            return {"skipped": "optimization gone or no longer running"}

        service = StrategyOptimizationService(session)
        # Use the coin universe frozen at plan time; expand() is deterministic
        # given (spec, coins, seed), so this reproduces the parent's plan
        # exactly. Falling back to a live resolve covers optimizations planned
        # before the freeze existed.
        #
        # ``only_market`` matters more than it looks: every one of possibly
        # thousands of children runs this expansion, and without the filter each
        # would build a parameter blob for every combo in the grid just to throw
        # all but its own away.
        frozen = opt.spec.get("resolved_coins")
        coins = (
            [tuple(c) for c in frozen]
            if frozen is not None
            else await service.resolve_coins(opt.spec.get("coins", {}), opt.seed)
        )
        mine, _, _ = expand(
            opt.spec, coins, list(opt.spec.get("intervals") or []),
            max_combos=opt.max_combos, seed=opt.seed,
            baseline_params=opt.spec.get("baseline_params") or None,
            only_market=(coin_id, quote_asset, interval),
        )
        if not mine:
            return {"skipped": "no combos for this market"}

        runner = OptimizationRunner(session)
        try:
            results, error = await runner.run_market(
                coin_id, quote_asset, interval, opt.start_date, opt.end_date, mine,
                strategy=opt.strategy,
            )
        except Exception as exc:  # one bad market must not sink the whole grid
            log.warning(
                "optimization.market_failed",
                optimization_id=optimization_id, coin_id=coin_id,
                interval=interval, error=str(exc),
            )
            results, error = [], str(exc)

        for r in results:
            session.add(StrategyOptimizationResult(optimization_id=optimization_id, **r))

        # Counters move in one atomic statement: several markets finish
        # concurrently, and a read-modify-write would lose increments and leave
        # the optimization stuck a few short of its total forever.
        done_inc = len(results)
        skip_inc = len(mine) if error else 0
        await session.execute(
            update(StrategyOptimization)
            .where(StrategyOptimization.id == optimization_id)
            .values(
                n_done=StrategyOptimization.n_done + done_inc,
                n_skipped=StrategyOptimization.n_skipped + skip_inc,
            )
        )
        await session.commit()

        # Column SELECT, not session.get: the identity map would hand back the
        # instance loaded at child start (expire_on_commit=False), blind to
        # sibling increments — the last child would then never see the counters
        # reach the total and the optimization would stay "running" forever.
        counters = (
            await session.execute(
                select(
                    StrategyOptimization.n_done,
                    StrategyOptimization.n_skipped,
                    StrategyOptimization.n_total,
                ).where(StrategyOptimization.id == optimization_id)
            )
        ).one_or_none()
        if counters is not None and counters.n_done + counters.n_skipped >= counters.n_total:
            values: dict = {"status": "success", "finished_at": datetime.now(UTC)}
            if counters.n_done == 0:
                values["status"] = "error"
                values["error"] = "No market produced results — check the date range and coins."
            await session.execute(
                update(StrategyOptimization)
                .where(
                    StrategyOptimization.id == optimization_id,
                    StrategyOptimization.status == "running",
                )
                .values(**values)
            )
            await session.commit()

    return {"scored": len(results), "error": error}
