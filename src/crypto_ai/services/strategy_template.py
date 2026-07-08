"""Service layer for trading-strategy parameter templates."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.strategy_template import StrategyTemplate
from crypto_ai.schemas.strategy_template import (
    StrategyTemplateCreate,
    StrategyTemplateUpdate,
)


class StrategyTemplateService:
    """CRUD for strategy parameter templates (global, soft-deleted)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, data: StrategyTemplateCreate) -> StrategyTemplate:
        template = StrategyTemplate(**data.model_dump())
        self.session.add(template)
        await self.session.flush()
        return template

    async def get(self, template_id: str) -> StrategyTemplate | None:
        result = await self.session.execute(
            select(StrategyTemplate).where(StrategyTemplate.id == template_id)
        )
        return result.scalar_one_or_none()

    async def list(self, strategy: str | None = None) -> list[StrategyTemplate]:
        stmt = select(StrategyTemplate).where(StrategyTemplate.active == True)  # noqa: E712
        if strategy:
            stmt = stmt.where(StrategyTemplate.strategy == strategy)
        stmt = stmt.order_by(StrategyTemplate.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def update(
        self, template_id: str, data: StrategyTemplateUpdate
    ) -> StrategyTemplate | None:
        template = await self.get(template_id)
        if not template:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(template, key, value)
        await self.session.flush()
        return template

    async def delete(self, template_id: str) -> bool:
        template = await self.get(template_id)
        if not template:
            return False
        template.active = False
        await self.session.flush()
        return True
