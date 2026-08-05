"""Coin group service — CRUD over groups plus membership management.

Groups are global. Membership add is idempotent (ignores duplicates); the
reserved favorites group is auto-created if missing and cannot be deleted.
"""

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.coin_group import FAVORITES_SLUG, CoinGroup
from crypto_ai.database.models.coin_group_member import CoinGroupMember
from crypto_ai.schemas.coin_group import CoinGroupCreate, CoinGroupUpdate


class CoinGroupService:
    """Service for coin groups and their membership."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Groups ────────────────────────────────────────────────────────────────

    async def list_groups(self) -> list[CoinGroup]:
        stmt = select(CoinGroup).where(CoinGroup.active.is_(True)).order_by(CoinGroup.name)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get(self, id: str) -> CoinGroup | None:
        return (
            await self.session.execute(select(CoinGroup).where(CoinGroup.id == id))
        ).scalar_one_or_none()

    async def get_by_slug(self, slug: str) -> CoinGroup | None:
        return (
            await self.session.execute(select(CoinGroup).where(CoinGroup.slug == slug))
        ).scalar_one_or_none()

    async def create(self, data: CoinGroupCreate) -> CoinGroup:
        group = CoinGroup(**data.model_dump())
        self.session.add(group)
        await self.session.flush()
        return group

    async def update(self, id: str, data: CoinGroupUpdate) -> CoinGroup | None:
        group = await self.get(id)
        if not group:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(group, key, value)
        await self.session.flush()
        return group

    async def delete(self, id: str) -> bool:
        """Delete a group and its memberships. Reserved (slug) groups are kept."""
        group = await self.get(id)
        if not group or group.slug is not None:
            return False
        await self.session.execute(
            delete(CoinGroupMember).where(CoinGroupMember.coin_group_id == id)
        )
        await self.session.delete(group)
        await self.session.flush()
        return True

    async def favorites_group(self) -> CoinGroup:
        """The reserved favorites group, created on first use if absent."""
        group = await self.get_by_slug(FAVORITES_SLUG)
        if group is None:
            group = CoinGroup(name="Favorites", slug=FAVORITES_SLUG)
            self.session.add(group)
            await self.session.flush()
        return group

    # ── Membership ────────────────────────────────────────────────────────────

    async def member_coin_ids(self, group_id: str) -> list[str]:
        rows = await self.session.execute(
            select(CoinGroupMember.coin_id).where(
                CoinGroupMember.coin_group_id == group_id
            )
        )
        return [r[0] for r in rows.all()]

    async def add_members(self, group_id: str, coin_ids: list[str]) -> int:
        """Add coins to a group, ignoring any already present. Returns count added."""
        if not coin_ids:
            return 0
        stmt = pg_insert(CoinGroupMember).values(
            [{"coin_group_id": group_id, "coin_id": cid} for cid in coin_ids]
        )
        result = await self.session.execute(
            stmt.on_conflict_do_nothing(
                index_elements=["coin_group_id", "coin_id"]
            )
        )
        await self.session.flush()
        return result.rowcount or 0

    async def remove_members(self, group_id: str, coin_ids: list[str]) -> int:
        """Remove coins from a group. Returns count removed."""
        if not coin_ids:
            return 0
        result = await self.session.execute(
            delete(CoinGroupMember).where(
                CoinGroupMember.coin_group_id == group_id,
                CoinGroupMember.coin_id.in_(coin_ids),
            )
        )
        await self.session.flush()
        return result.rowcount or 0
