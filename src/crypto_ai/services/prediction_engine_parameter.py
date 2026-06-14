"""Prediction engine parameter service."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.prediction_engine_parameter import PredictionEngineParameter
from crypto_ai.schemas.prediction import PredictionEngineParameterCreate


class PredictionEngineParameterService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_by_engine(self, engine_id: str) -> list[PredictionEngineParameter]:
        """List engine-level parameters (no strategy scope)."""
        result = await self.session.execute(
            select(PredictionEngineParameter)
            .where(
                PredictionEngineParameter.prediction_engine_id == engine_id,
                PredictionEngineParameter.prediction_strategy_id.is_(None),
                PredictionEngineParameter.active.is_(True),
            )
            .order_by(PredictionEngineParameter.sort_order)
        )
        return list(result.scalars().all())

    async def list_by_strategy(self, strategy_id: str) -> list[PredictionEngineParameter]:
        """List parameters scoped to a prediction strategy."""
        result = await self.session.execute(
            select(PredictionEngineParameter)
            .where(
                PredictionEngineParameter.prediction_strategy_id == strategy_id,
                PredictionEngineParameter.active.is_(True),
            )
            .order_by(PredictionEngineParameter.sort_order)
        )
        return list(result.scalars().all())

    async def create(
        self,
        engine_id: str,
        data: PredictionEngineParameterCreate,
        strategy_id: str | None = None,
    ) -> PredictionEngineParameter:
        param = PredictionEngineParameter(
            prediction_engine_id=engine_id,
            prediction_strategy_id=strategy_id,
            name=data.name,
            value=data.value,
            parameter=data.parameter,
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
            # Deselect others in the same group (same engine, same strategy scope, same name)
            deselect_filter = [
                PredictionEngineParameter.prediction_engine_id == param.prediction_engine_id,
                PredictionEngineParameter.name == param.name,
                PredictionEngineParameter.active.is_(True),
                PredictionEngineParameter.selected.is_(True),
            ]
            if param.prediction_strategy_id:
                deselect_filter.append(
                    PredictionEngineParameter.prediction_strategy_id
                    == param.prediction_strategy_id,
                )
            else:
                deselect_filter.append(
                    PredictionEngineParameter.prediction_strategy_id.is_(None),
                )
            await self.session.execute(
                update(PredictionEngineParameter)
                .where(*deselect_filter)
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
