"""Periodic Celery task that steps every running paper-trade run forward.

Fired by Celery beat (see ``celery_app.beat_schedule``) roughly once a minute,
and once on demand when a run is started. Each invocation loads the running
runs, replays their strategies over any newly-closed bars, records fills, and
marks equity — all inside ``PaperTradeEngine`` (which commits per run).
"""

import asyncio

import structlog

from crypto_ai.database.connection import task_session
from crypto_ai.services.paper_trade_engine import PaperTradeEngine
from crypto_ai.tasks.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(
    name="crypto_ai.tasks.paper_trade.step_paper_trades",
    # A tick is idempotent and cheap; if one overruns, just drop the overlap
    # rather than pile up a backlog behind a slow one.
    time_limit=300,
    soft_time_limit=270,
)
def step_paper_trades() -> dict:
    """Advance all running paper-trade runs by any new bars."""
    return asyncio.run(_step_all())


async def _step_all() -> dict:
    async with task_session() as session:
        stepped = await PaperTradeEngine(session).step_all()
    return {"stepped": stepped}


@celery_app.task(
    name="crypto_ai.tasks.paper_trade.rotate_paper_sweeps",
    time_limit=300,
    soft_time_limit=270,
)
def rotate_paper_sweeps() -> dict:
    """Hourly sweep rotation: stop runs past their dwell, start the next combos."""
    return asyncio.run(_rotate_sweeps())


async def _rotate_sweeps() -> dict:
    from crypto_ai.services.paper_sweep import PaperSweepService

    async with task_session() as session:
        return await PaperSweepService(session).rotate()
