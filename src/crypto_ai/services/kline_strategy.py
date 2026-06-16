"""Service layer for KlineStrategy presets and their parameters."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.kline_strategy import KlineStrategy, KlineStrategyParameter
from crypto_ai.database.models.prediction_engine import PredictionEngine
from crypto_ai.database.models.prediction_engine_parameter import PredictionEngineParameter
from crypto_ai.schemas.kline_strategy import (
    KlineStrategyCreate,
    KlineStrategyParameterCreate,
    KlineStrategyParameterUpdate,
    KlineStrategyUpdate,
)


class KlineStrategyService:
    """CRUD for crypto-simulation strategy presets and their parameters."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Strategies ──────────────────────────────────────────────────────────

    async def create(self, data: KlineStrategyCreate) -> KlineStrategy:
        strategy = KlineStrategy(**data.model_dump())
        self.session.add(strategy)
        await self.session.flush()
        return strategy

    async def get(self, strategy_id: str) -> KlineStrategy | None:
        result = await self.session.execute(
            select(KlineStrategy).where(KlineStrategy.id == strategy_id)
        )
        return result.scalar_one_or_none()

    async def get_all(
        self, limit: int = 1000, offset: int = 0, include_inactive: bool = False
    ) -> list[KlineStrategy]:
        stmt = select(KlineStrategy).order_by(KlineStrategy.created_at.desc())
        if not include_inactive:
            stmt = stmt.where(KlineStrategy.active.is_(True))
        stmt = stmt.limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def update(self, strategy_id: str, data: KlineStrategyUpdate) -> KlineStrategy | None:
        strategy = await self.get(strategy_id)
        if not strategy:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(strategy, key, value)
        await self.session.flush()
        return strategy

    async def delete(self, strategy_id: str, hard_delete: bool = False) -> bool:
        strategy = await self.get(strategy_id)
        if not strategy:
            return False
        if hard_delete:
            await self.session.delete(strategy)
        else:
            strategy.active = False
        await self.session.flush()
        return True

    # ── Parameters ──────────────────────────────────────────────────────────

    async def list_parameters(self, strategy_id: str) -> list[KlineStrategyParameter]:
        result = await self.session.execute(
            select(KlineStrategyParameter)
            .where(KlineStrategyParameter.strategy_id == strategy_id)
            .order_by(KlineStrategyParameter.name, KlineStrategyParameter.created_at)
        )
        return list(result.scalars().all())

    async def add_parameter(
        self, strategy_id: str, data: KlineStrategyParameterCreate
    ) -> KlineStrategyParameter | None:
        strategy = await self.get(strategy_id)
        if not strategy:
            return None
        param = KlineStrategyParameter(strategy_id=strategy_id, **data.model_dump())
        self.session.add(param)
        await self.session.flush()
        return param

    async def get_parameter(self, param_id: str) -> KlineStrategyParameter | None:
        result = await self.session.execute(
            select(KlineStrategyParameter).where(KlineStrategyParameter.id == param_id)
        )
        return result.scalar_one_or_none()

    async def update_parameter(
        self, param_id: str, data: KlineStrategyParameterUpdate
    ) -> KlineStrategyParameter | None:
        param = await self.get_parameter(param_id)
        if not param:
            return None
        values = data.model_dump(exclude_unset=True)
        # Enforce one selected value per parameter name (like the ai-models tab):
        # selecting a value deselects its siblings in the same strategy + name group.
        if values.get("selected") is True:
            await self.session.execute(
                update(KlineStrategyParameter)
                .where(
                    KlineStrategyParameter.strategy_id == param.strategy_id,
                    KlineStrategyParameter.name == param.name,
                    KlineStrategyParameter.id != param.id,
                    KlineStrategyParameter.selected.is_(True),
                )
                .values(selected=False)
            )
        for key, value in values.items():
            setattr(param, key, value)
        await self.session.flush()
        return param

    async def copy_engine_parameters(
        self, strategy_id: str, engine_slug: str
    ) -> list[KlineStrategyParameter] | None:
        """Copy a prediction engine's parameters (by slug) onto the strategy.

        Mirrors the engine's parameter catalog shown on the ai-models page. Skips
        parameter names the strategy already has. Returns the newly added params,
        or None if the strategy doesn't exist.
        """
        strategy = await self.get(strategy_id)
        if not strategy:
            return None
        engine = (
            await self.session.execute(
                select(PredictionEngine).where(
                    PredictionEngine.slug == engine_slug,
                    PredictionEngine.active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if not engine:
            return []  # no matching engine catalog → nothing to copy
        engine_params = (
            await self.session.execute(
                select(PredictionEngineParameter)
                .where(
                    PredictionEngineParameter.prediction_engine_id == engine.id,
                    PredictionEngineParameter.prediction_strategy_id.is_(None),
                    PredictionEngineParameter.active.is_(True),
                )
                .order_by(PredictionEngineParameter.sort_order)
            )
        ).scalars().all()
        existing_names = {p.name for p in await self.list_parameters(strategy_id)}
        added: list[KlineStrategyParameter] = []
        for ep in engine_params:
            if ep.name in existing_names:
                continue
            param = KlineStrategyParameter(
                strategy_id=strategy_id,
                name=ep.name,
                value=ep.value,
                description=ep.description,
                selected=ep.selected,
            )
            self.session.add(param)
            added.append(param)
        await self.session.flush()
        return added

    async def delete_parameter(self, param_id: str) -> bool:
        param = await self.get_parameter(param_id)
        if not param:
            return False
        await self.session.delete(param)
        await self.session.flush()
        return True
