"""Coin routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from crypto_ai.api.deps import CoinServiceDep
from crypto_ai.schemas.coin import CoinCreate, CoinResponse, CoinUpdate

router = APIRouter()


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
