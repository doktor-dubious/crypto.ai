"""Prediction engine service."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.prediction_engine import PredictionEngine


class PredictionEngineService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_all(self, active_only: bool = True) -> list[PredictionEngine]:
        stmt = select(PredictionEngine)
        if active_only:
            stmt = stmt.where(PredictionEngine.active == True)  # noqa: E712
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
