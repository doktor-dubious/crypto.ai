"""Celery task for fetching coin metadata (CoinGecko categories) in the background.

CoinGecko is rate-limited (~30 calls/min on a Demo key), so tagging a set of
coins is done as a background task with polite throttling and progress updates
rather than holding an API request open.
"""

import asyncio
from datetime import UTC, datetime

import httpx
import structlog
from fastapi import HTTPException

from crypto_ai.config import get_settings
from crypto_ai.database.connection import task_session
from crypto_ai.services.coin import CoinService
from crypto_ai.services.coingecko import CoinGeckoService
from crypto_ai.services.task import TaskService
from crypto_ai.tasks.celery_app import celery_app

log = structlog.get_logger()

# Polite spacing between coins (each coin is 1-2 CoinGecko calls). The keyless
# CoinGecko tier is only a few calls/min; _get() also backs off on 429.
_THROTTLE_SECONDS = 3.0


@celery_app.task(
    bind=True,
    name="crypto_ai.tasks.metadata.run_category_refresh_task",
    time_limit=3600,
    soft_time_limit=3540,
)
def run_category_refresh_task(self, request_data: dict) -> dict:
    """Fetch CoinGecko categories for the given coins and store them."""
    return asyncio.run(
        _run_category_refresh_async(self.request.id, request_data, self.request.hostname)
    )


async def _run_category_refresh_async(
    task_id: str, request_data: dict, hostname: str | None = None
) -> dict:
    worker_name = hostname.split("@")[-1] if hostname else None
    coin_ids: list[str] = request_data.get("coin_ids") or []

    # Guard against Celery redelivery.
    async with task_session() as session:
        ts = TaskService(session)
        try:
            record = await ts.get(task_id)
            if record.status != "pending":
                return {"skipped": True, "reason": f"task status is {record.status}"}
        except HTTPException:
            return {"skipped": True, "reason": "redelivered task not in DB"}

        await ts.update_status(
            task_id, "started", started_at=datetime.now(UTC),
            name=request_data.get("name") or "Categories", worker_name=worker_name,
        )
        await session.commit()

    async def _persist(progress: int, message: str) -> None:
        from crypto_ai.tasks.celery_app import refresh_worker_registry
        refresh_worker_registry()
        async with task_session() as s:
            await TaskService(s).update_progress(task_id, progress, message)
            await s.commit()

    gecko = CoinGeckoService(api_key=get_settings().coingecko_api_key)
    matched = 0
    total = max(1, len(coin_ids))
    try:
        async with httpx.AsyncClient() as client:
            await _persist(0, "Fetching CoinGecko coin list…")
            listing = await gecko.fetch_coin_list(client)

            for idx, coin_id in enumerate(coin_ids):
                # Re-open a short session per coin so a slow run doesn't hold one open.
                async with task_session() as session:
                    coin = await CoinService(session).get(coin_id)
                    if not coin:
                        continue
                    symbol, name = coin.symbol, coin.name

                categories: list[str] = []
                try:
                    gecko_id = await gecko.resolve_gecko_id(client, symbol, name, listing)
                    if gecko_id:
                        categories = await gecko.fetch_categories(client, gecko_id)
                        matched += 1
                except httpx.HTTPError as e:
                    log.warning("coingecko fetch failed", symbol=symbol, error=str(e))

                async with task_session() as session:
                    await CoinService(session).set_categories(coin_id, categories)
                    await session.commit()

                progress = min(99, int((idx + 1) / total * 100))
                await _persist(progress, f"{symbol}: {len(categories)} categories")
                await asyncio.sleep(_THROTTLE_SECONDS)

        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "success", completed_at=datetime.now(UTC)
            )
            await session.commit()

        return {"matched": matched, "total": len(coin_ids)}
    except Exception as e:
        log.error(f"Category refresh task failed: {e}", exc_info=True)
        async with task_session() as session:
            await TaskService(session).update_status(
                task_id, "failure", completed_at=datetime.now(UTC), error=str(e)
            )
            await session.commit()
        raise
