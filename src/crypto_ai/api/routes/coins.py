"""Coin routes."""

import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import CoinServiceDep, DbSession, TaskServiceDep
from crypto_ai.schemas.coin import CoinCreate, CoinResponse, CoinUpdate
from crypto_ai.services.market_availability import MarketAvailabilityService

router = APIRouter()


@router.post("/refresh-markets")
async def refresh_markets(
    session: DbSession,
    coin_service: CoinServiceDep,
    coin_ids: Annotated[
        list[str] | None, Query(description="Coin UUIDs; all active coins if omitted")
    ] = None,
) -> dict:
    """Refresh Binance spot / futures availability flags for the given coins.

    Fetches the Binance spot markets and the CoinGecko binance_futures perpetual
    listing once, then flags each coin. Runs inline (two HTTP calls total, no
    per-coin work) so no background task is needed.
    """
    coins = await coin_service.get_all(limit=100000)
    if coin_ids:
        wanted = set(coin_ids)
        coins = [c for c in coins if c.id in wanted]
    if not coins:
        return {"count": 0, "spot": 0, "futures": 0, "message": "No coins to refresh"}

    async with httpx.AsyncClient() as client:
        sets = await MarketAvailabilityService().fetch(client)

    spot_n = fut_n = 0
    for coin in coins:
        has_spot = sets.spot_flag(coin.symbol)
        has_futures = sets.futures_flag(coin.symbol)
        await coin_service.set_markets(coin.id, has_spot, has_futures)
        spot_n += 1 if has_spot else 0
        fut_n += 1 if has_futures else 0
    await session.commit()

    return {
        "count": len(coins),
        "spot": spot_n,
        "futures": fut_n,
        "spot_source": sets.spot is not None,
        "futures_source": sets.futures is not None,
    }


@router.post("/refresh-categories")
async def refresh_categories(
    task_service: TaskServiceDep,
    session: DbSession,
    coin_service: CoinServiceDep,
    coin_ids: Annotated[
        list[str] | None, Query(description="Coin UUIDs; all active coins if omitted")
    ] = None,
) -> dict:
    """Fetch CoinGecko categories for the given coins (or all) in the background.

    Enqueues a single task that tags each coin with its CoinGecko categories.
    Poll status via GET /binance-import/tasks/{task_id} like other tasks.
    """
    from crypto_ai.tasks.metadata import run_category_refresh_task

    if coin_ids:
        ids = coin_ids
    else:
        coins = await coin_service.get_all(limit=100000)
        ids = [c.id for c in coins]

    if not ids:
        return {"task_id": None, "count": 0, "message": "No coins to classify"}

    name = f"Categories · {len(ids)} coin(s)"
    request_data = {"coin_ids": ids, "name": name}
    task_id = str(uuid.uuid4())
    await task_service.create(task_id, "metadata", None, name=name, request_data=request_data)
    await session.commit()

    run_category_refresh_task.apply_async(args=[request_data], task_id=task_id)
    return {"task_id": task_id, "count": len(ids), "name": name}


@router.post("", response_model=CoinResponse, status_code=201)
async def create_coin(data: CoinCreate, service: CoinServiceDep) -> CoinResponse:
    """Create a new coin."""
    coin = await service.create(data)
    return coin


@router.get("", response_model=list[CoinResponse])
async def list_coins(
    service: CoinServiceDep,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_inactive: bool = False,
) -> list[CoinResponse]:
    """List coins with pagination."""
    coins = await service.get_all(limit=limit, offset=offset, include_inactive=include_inactive)
    return coins


@router.get("/{coin_id}", response_model=CoinResponse)
async def get_coin(coin_id: str, service: CoinServiceDep) -> CoinResponse:
    """Get a specific coin."""
    coin = await service.get(coin_id)
    if not coin:
        raise HTTPException(status_code=404, detail="Coin not found")
    return coin


@router.patch("/{coin_id}", response_model=CoinResponse)
async def update_coin(
    coin_id: str, data: CoinUpdate, service: CoinServiceDep
) -> CoinResponse:
    """Update a coin."""
    coin = await service.update(coin_id, data)
    if not coin:
        raise HTTPException(status_code=404, detail="Coin not found")
    return coin


@router.delete("/{coin_id}")
async def delete_coin(
    coin_id: str, service: CoinServiceDep, hard_delete: bool = False
) -> dict[str, bool]:
    """Delete a coin."""
    success = await service.delete(coin_id, hard_delete=hard_delete)
    if not success:
        raise HTTPException(status_code=404, detail="Coin not found")
    return {"success": True}
