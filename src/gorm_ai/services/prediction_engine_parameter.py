"""Prediction engine parameter service."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.prediction_engine_parameter import PredictionEngineParameter
from gorm_ai.schemas.prediction import PredictionEngineParameterCreate


class PredictionEngineParameterService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_by_engine(self, engine_id: str) -> list[PredictionEngineParameter]:
        result = await self.session.execute(
            select(PredictionEngineParameter)
            .where(
                PredictionEngineParameter.prediction_engine_id == engine_id,
                PredictionEngineParameter.active.is_(True),
            )
            .order_by(PredictionEngineParameter.sort_order)
        )
        return list(result.scalars().all())

    async def create(
        self, engine_id: str, data: PredictionEngineParameterCreate,
    ) -> PredictionEngineParameter:
        param = PredictionEngineParameter(
            prediction_engine_id=engine_id,
            name=data.name,
            value=data.value,
            description=data.description,
            sort_order=data.sort_order,
        )
        self.session.add(param)
        await self.session.flush()
        await self.session.refresh(param)
        return param

    async def toggle_selected(
        self, param_id: str,
    ) -> PredictionEngineParameter | None:
        result = await self.session.execute(
            select(PredictionEngineParameter).where(
                PredictionEngineParameter.id == param_id,
                PredictionEngineParameter.active.is_(True),
            )
        )
        param = result.scalar_one_or_none()
        if not param:
            return None

        if param.selected:
            # Deselect
            param.selected = False
        else:
            # Deselect others in the same group, then select this one
            await self.session.execute(
                update(PredictionEngineParameter)
                .where(
                    PredictionEngineParameter.prediction_engine_id
                    == param.prediction_engine_id,
                    PredictionEngineParameter.name == param.name,
                    PredictionEngineParameter.active.is_(True),
                    PredictionEngineParameter.selected.is_(True),
                )
                .values(selected=False)
            )
            param.selected = True

        await self.session.flush()
        await self.session.refresh(param)
        return param

    async def delete(self, param_id: str) -> bool:
        result = await self.session.execute(
            select(PredictionEngineParameter).where(
                PredictionEngineParameter.id == param_id,
                PredictionEngineParameter.active.is_(True),
            )
        )
        param = result.scalar_one_or_none()
        if not param:
            return False
        await self.session.delete(param)
        await self.session.flush()
        return True
