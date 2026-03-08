"""PredictionStrategy service."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.prediction_strategy import PredictionStrategy
from gorm_ai.schemas.prediction import PredictionStrategyCreate, PredictionStrategyUpdate


class PredictionStrategyService:
    """Service for prediction strategy CRUD operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: PredictionStrategyCreate) -> PredictionStrategy:
        strategy = PredictionStrategy(
            customer_id=data.customer_id,
            name=data.name,
            description=data.description,
            type=data.type,
        )
        self.session.add(strategy)
        await self.session.flush()
        await self.session.refresh(strategy)
        return strategy

    async def get(self, strategy_id: str) -> PredictionStrategy | None:
        result = await self.session.execute(
            select(PredictionStrategy).where(
                PredictionStrategy.id == strategy_id,
                PredictionStrategy.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def list_by_customer(self, customer_id: str) -> list[PredictionStrategy]:
        result = await self.session.execute(
            select(PredictionStrategy)
            .where(
                PredictionStrategy.customer_id == customer_id,
                PredictionStrategy.active.is_(True),
            )
            .order_by(PredictionStrategy.name)
        )
        return list(result.scalars().all())

    async def update(self, strategy_id: str, data: PredictionStrategyUpdate) -> PredictionStrategy | None:
        strategy = await self.get(strategy_id)
        if not strategy:
            return None
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(strategy, field, value)
        await self.session.flush()
        await self.session.refresh(strategy)
        return strategy

    async def delete(self, strategy_id: str) -> bool:
        strategy = await self.get(strategy_id)
        if not strategy:
            return False
        strategy.active = False
        await self.session.flush()
        return True
