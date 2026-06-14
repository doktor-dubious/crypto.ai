"""Prediction engine service."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.prediction_engine import PredictionEngine
from crypto_ai.schemas.prediction import PredictionEngineCreate, PredictionEngineUpdate


class PredictionEngineService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_all(self, active_only: bool = True) -> list[PredictionEngine]:
        stmt = select(PredictionEngine)
        if active_only:
            stmt = stmt.where(PredictionEngine.active == True)  # noqa: E712
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, engine_id: str) -> PredictionEngine | None:
        result = await self.session.execute(
            select(PredictionEngine).where(
                PredictionEngine.id == engine_id,
                PredictionEngine.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def create(self, data: PredictionEngineCreate) -> PredictionEngine:
        engine = PredictionEngine(
            slug=data.slug,
            name=data.name,
            description=data.description,
            notes=data.notes,
        )
        self.session.add(engine)
        await self.session.flush()
        await self.session.refresh(engine)
        return engine

    async def update(self, engine_id: str, data: PredictionEngineUpdate) -> PredictionEngine | None:
        engine = await self.get(engine_id)
        if not engine:
            return None
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(engine, field, value)
        await self.session.flush()
        await self.session.refresh(engine)
        return engine

    async def delete(self, engine_id: str) -> bool:
        engine = await self.get(engine_id)
        if not engine:
            return False
        engine.active = False
        await self.session.flush()
        return True
