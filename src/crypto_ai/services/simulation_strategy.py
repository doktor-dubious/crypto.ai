"""SimulationStrategy service."""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.simulation_strategy import SimulationStrategy
from crypto_ai.schemas.simulation_strategy import SimulationStrategyCreate, SimulationStrategyUpdate


class SimulationStrategyService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list(self, customer_id: str) -> list[SimulationStrategy]:
        result = await self.session.execute(
            select(SimulationStrategy)
            .where(SimulationStrategy.customer_id == customer_id, SimulationStrategy.active == True)
            .order_by(SimulationStrategy.created_at.desc())
        )
        return list(result.scalars().all())

    async def get(self, strategy_id: str) -> SimulationStrategy | None:
        result = await self.session.execute(
            select(SimulationStrategy).where(
                SimulationStrategy.id == strategy_id, SimulationStrategy.active == True
            )
        )
        return result.scalar_one_or_none()

    async def create(self, data: SimulationStrategyCreate) -> SimulationStrategy:
        strategy = SimulationStrategy(
            id=str(uuid4()),
            customer_id=data.customer_id,
            prediction_strategy_id=data.prediction_strategy_id,
            type=data.type,
            delay=data.delay,
        )
        self.session.add(strategy)
        await self.session.commit()
        await self.session.refresh(strategy)
        return strategy

    async def update(self, strategy_id: str, data: SimulationStrategyUpdate) -> SimulationStrategy | None:
        strategy = await self.get(strategy_id)
        if not strategy:
            return None
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(strategy, field, value)
        await self.session.commit()
        await self.session.refresh(strategy)
        return strategy

    async def delete(self, strategy_id: str) -> bool:
        strategy = await self.get(strategy_id)
        if not strategy:
            return False
        strategy.active = False
        await self.session.commit()
        return True
