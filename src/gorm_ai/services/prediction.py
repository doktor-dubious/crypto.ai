"""Prediction service for managing predictions."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.prediction.registry import EngineRegistry
from gorm_ai.schemas.prediction import (
    PredictionEngine,
    PredictionRequest,
    PredictionResponse,
)
from gorm_ai.services.sales import SalesService

_CONFIGURATION_SINGLETON_ID = "00000000-0000-0000-0000-000000000001"
_HISTORY_LOOKBACK_DAYS = 90


class PredictionService:
    """Service for prediction operations."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.sales_service = SalesService(session)
        self.engine_registry = EngineRegistry()

    async def create_prediction(self, request: PredictionRequest) -> PredictionResponse:
        """Create a prediction based on historical sales data."""
        # Resolve which engine to use (request → customer config → global config → default)
        engine_type = await self._resolve_engine(request.customer_id, request.engine)

        # Horizon = number of days in the prediction window (inclusive)
        horizon = (request.prediction_to - request.prediction_from).days + 1
        if horizon < 1:
            raise ValueError("prediction_to must be on or after prediction_from")

        # Fetch historical data from the 90 days prior to the prediction window
        history_end = request.prediction_from - timedelta(days=1)
        history_start = history_end - timedelta(days=_HISTORY_LOOKBACK_DAYS - 1)

        sales_data = await self.sales_service.get_by_date_range(
            customer_id=request.customer_id,
            outlet_id=request.outlet_id,
            start_date=history_start,
            end_date=history_end,
        )

        engine = self.engine_registry.get_engine(engine_type)
        historical_data = self._prepare_historical_data(sales_data)

        results = await engine.predict(
            historical_data=historical_data,
            horizon=horizon,
            **(request.engine_params or {}),
        )

        return PredictionResponse(
            id=str(uuid4()),
            customer_id=request.customer_id,
            outlet_id=request.outlet_id,
            engine=engine_type,
            horizon=horizon,
            results=results,
            created_at=datetime.now(UTC),
        )

    async def _resolve_engine(
        self,
        customer_id: str,
        requested: PredictionEngine | None,
    ) -> PredictionEngine:
        """Resolve the prediction engine using the 3-tier fallback chain."""
        # 1. Explicit request parameter wins
        if requested is not None:
            return requested

        # 2. Customer-level default
        result = await self.session.execute(
            select(CustomerConfiguration)
            .where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
            .options(selectinload(CustomerConfiguration.prediction_engine))
        )
        customer_config = result.scalar_one_or_none()
        if customer_config and customer_config.prediction_engine:
            return PredictionEngine(customer_config.prediction_engine.slug)

        # 3. Global application default
        result = await self.session.execute(
            select(Configuration)
            .where(Configuration.id == _CONFIGURATION_SINGLETON_ID)
            .options(selectinload(Configuration.prediction_engine))
        )
        global_config = result.scalar_one_or_none()
        if global_config and global_config.prediction_engine:
            return PredictionEngine(global_config.prediction_engine.slug)

        # 4. Hardcoded fallback
        return PredictionEngine.STATISTICAL

    def _prepare_historical_data(self, sales_data: list) -> list[dict]:
        """Prepare sales data for prediction engine."""
        return [
            {
                "date": sale.date,
                "value": sale.sold,
            }
            for sale in sales_data
        ]

    def get_available_engines(self) -> list[PredictionEngine]:
        """Get list of available prediction engines."""
        return self.engine_registry.get_available_engines()
