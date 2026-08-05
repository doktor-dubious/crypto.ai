"""Periodic Celery task that steps every running live-trade run forward.

Fired by Celery beat once a minute (and once on demand when a run starts).
Each invocation reconciles every running live run's actual Binance position
against its strategy's target position, placing real market orders for the
difference — all inside ``LiveTradeEngine`` (which commits per run).
"""

import asyncio

import structlog

from crypto_ai.database.connection import task_session
from crypto_ai.services.live_trade_engine import LiveTradeEngine
from crypto_ai.tasks.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(
    name="crypto_ai.tasks.live_trade.step_live_trades",
    # A tick may include real order round-trips + an AI consultation; cap it the
    # same as paper and let the next beat pick up where this one stopped.
    time_limit=300,
    soft_time_limit=270,
)
def step_live_trades() -> dict:
    """Advance all running live-trade runs by any new bars."""
    return asyncio.run(_step_all())


async def _step_all() -> dict:
    async with task_session() as session:
        stepped = await LiveTradeEngine(session).step_all()
    return {"stepped": stepped}
