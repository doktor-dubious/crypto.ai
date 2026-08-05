"""Coin group routes — arbitrary groups plus the reserved favorites group.

The favorites endpoints are convenience wrappers so the coins-page heart UI never
needs to know the favorites group's id.
"""

from typing import Annotated

from fastapi import APIRouter, Body, HTTPException

from crypto_ai.api.deps import CoinGroupServiceDep, DbSession
from crypto_ai.schemas.coin_group import (
    CoinGroupCreate,
    CoinGroupResponse,
    CoinGroupUpdate,
)
from crypto_ai.services.coin_group import CoinGroupService

router = APIRouter()


async def _to_response(service: CoinGroupService, group) -> CoinGroupResponse:
    resp = CoinGroupResponse.model_validate(group)
    resp.member_coin_ids = await service.member_coin_ids(group.id)
    return resp


# ── Favorites (fixed paths — must precede /{group_id}) ───────────────────────


@router.get("/favorites", response_model=CoinGroupResponse)
async def get_favorites(service: CoinGroupServiceDep, session: DbSession) -> CoinGroupResponse:
    """The reserved favorites group and its member coin ids."""
    group = await service.favorites_group()
    await session.commit()
    return await _to_response(service, group)


@router.post("/favorites/members", response_model=CoinGroupResponse)
async def add_favorites(
    service: CoinGroupServiceDep,
    session: DbSession,
    coin_ids: Annotated[list[str], Body(embed=True, description="Coin UUIDs to favorite")],
) -> CoinGroupResponse:
    """Add one or more coins to favorites (idempotent)."""
    group = await service.favorites_group()
    await service.add_members(group.id, coin_ids)
    await session.commit()
    return await _to_response(service, group)


@router.delete("/favorites/members", response_model=CoinGroupResponse)
async def remove_favorites(
    service: CoinGroupServiceDep,
    session: DbSession,
    coin_ids: Annotated[list[str], Body(embed=True, description="Coin UUIDs to unfavorite")],
) -> CoinGroupResponse:
    """Remove one or more coins from favorites."""
    group = await service.favorites_group()
    await service.remove_members(group.id, coin_ids)
    await session.commit()
    return await _to_response(service, group)


# ── Generic group CRUD ───────────────────────────────────────────────────────


@router.get("", response_model=list[CoinGroupResponse])
async def list_groups(service: CoinGroupServiceDep) -> list[CoinGroupResponse]:
    """List all coin groups with their members."""
    groups = await service.list_groups()
    return [await _to_response(service, g) for g in groups]


@router.post("", response_model=CoinGroupResponse, status_code=201)
async def create_group(
    data: CoinGroupCreate, service: CoinGroupServiceDep, session: DbSession
) -> CoinGroupResponse:
    """Create a coin group."""
    group = await service.create(data)
    await session.commit()
    return await _to_response(service, group)


@router.patch("/{group_id}", response_model=CoinGroupResponse)
async def update_group(
    group_id: str,
    data: CoinGroupUpdate,
    service: CoinGroupServiceDep,
    session: DbSession,
) -> CoinGroupResponse:
    """Update a coin group's name / description / notes."""
    group = await service.update(group_id, data)
    if not group:
        raise HTTPException(status_code=404, detail="Coin group not found")
    await session.commit()
    return await _to_response(service, group)


@router.delete("/{group_id}")
async def delete_group(
    group_id: str, service: CoinGroupServiceDep, session: DbSession
) -> dict[str, bool]:
    """Delete a coin group (reserved groups like favorites cannot be deleted)."""
    ok = await service.delete(group_id)
    if not ok:
        raise HTTPException(
            status_code=400, detail="Group not found or is a reserved group"
        )
    await session.commit()
    return {"success": True}


@router.post("/{group_id}/members", response_model=CoinGroupResponse)
async def add_members(
    group_id: str,
    service: CoinGroupServiceDep,
    session: DbSession,
    coin_ids: Annotated[list[str], Body(embed=True, description="Coin UUIDs to add")],
) -> CoinGroupResponse:
    """Add coins to a group (idempotent)."""
    group = await service.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Coin group not found")
    await service.add_members(group_id, coin_ids)
    await session.commit()
    return await _to_response(service, group)


@router.delete("/{group_id}/members", response_model=CoinGroupResponse)
async def remove_members(
    group_id: str,
    service: CoinGroupServiceDep,
    session: DbSession,
    coin_ids: Annotated[list[str], Body(embed=True, description="Coin UUIDs to remove")],
) -> CoinGroupResponse:
    """Remove coins from a group."""
    group = await service.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Coin group not found")
    await service.remove_members(group_id, coin_ids)
    await session.commit()
    return await _to_response(service, group)
