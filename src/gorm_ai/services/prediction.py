"""Prediction service for managing predictions."""

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.financial_date import FinancialDate, OutletFinancialDate
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_financials import OutletFinancials
from gorm_ai.database.models.pad import Pad
from gorm_ai.prediction.registry import EngineRegistry
from gorm_ai.schemas.prediction import (
    OutletPrediction,
    PredictionEngine,
    PredictionRequest,
    PredictionResponse,
)
from gorm_ai.services.sales import SalesService

_CONFIGURATION_SINGLETON_ID = "00000000-0000-0000-0000-000000000001"


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

        engine = self.engine_registry.get_engine(engine_type)
        capabilities = engine.get_capabilities()

        # Resolve outlet IDs: explicit list → all active outlets for customer
        outlet_ids = request.outlet_ids
        if not outlet_ids:
            outlet_ids = await self._get_active_outlet_ids(request.customer_id)

        # Fetch all historical data up to the cutoff (delay days before the prediction window)
        history_end = request.prediction_from - timedelta(days=1 + request.delay)

        # Pad event dates are customer-level (same for all outlets; effect learned per outlet by Ridge)
        pad_covariates = await self._build_pad_covariates(request.customer_id) if request.use_pad else None

        outlets: list[OutletPrediction] = []
        for outlet_id in outlet_ids:
            sales_data = await self.sales_service.get_by_date_range(
                customer_id=request.customer_id,
                outlet_id=outlet_id,
                end_date=history_end,
                apply_sales_filter=True,
            )

            historical_data = self._prepare_historical_data(sales_data)

            # Trim to engine's max context if needed (keep the most recent records)
            if capabilities.max_history_length and len(historical_data) > capabilities.max_history_length:
                historical_data = historical_data[-capabilities.max_history_length:]

            if request.use_financials:
                cov_start = sales_data[0].date if sales_data else request.prediction_from
                cov_end = request.prediction_from + timedelta(days=horizon - 1)
                covariates = await self._build_covariates(
                    outlet_id, request.customer_id, cov_start, cov_end
                )
            else:
                covariates = None

            results = await engine.predict(
                historical_data=historical_data,
                horizon=horizon,
                prediction_from=request.prediction_from,
                covariates=covariates,
                pad_dates=pad_covariates,
                **(request.engine_params or {}),
            )

            outlets.append(OutletPrediction(outlet_id=outlet_id, results=results))

        return PredictionResponse(
            id=str(uuid4()),
            customer_id=request.customer_id,
            engine=engine_type,
            horizon=horizon,
            outlets=outlets,
            created_at=datetime.now(UTC),
        )

    async def _get_active_outlet_ids(self, customer_id: str) -> list[str]:
        """Fetch all active outlet IDs for a customer."""
        result = await self.session.execute(
            select(Outlet.id).where(
                Outlet.customer_id == customer_id,
                Outlet.active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def _build_covariates(
        self, outlet_id: str, customer_id: str, start_date: date, end_date: date
    ) -> dict[str, dict[date, float]] | None:
        """Build date-keyed covariates using the 4-level financial fallback chain.

        For each date in [start_date, end_date]:
          A) outlet_financial_date  — per-outlet override when a FinancialDate record
             covers customer_id + weekday + date range
          B) outlet_financials      — weekday-based per-outlet defaults
          C) customer_configuration — customer-wide defaults
          D) configuration          — global singleton defaults

        Returns a dict mapping feature name to {date: value}, or None when no
        financial data exists anywhere in the fallback chain.
        """
        # Level B: weekday-based OutletFinancials
        weekday_cost: dict[int, float] = {}
        weekday_profit: dict[int, float] = {}
        result = await self.session.execute(
            select(OutletFinancials).where(
                OutletFinancials.outlet_id == outlet_id,
                OutletFinancials.active.is_(True),
            )
        )
        for row in result.scalars():
            if row.cost_per_unit is not None:
                weekday_cost[row.weekday] = row.cost_per_unit
            if row.profit_per_unit is not None:
                weekday_profit[row.weekday] = row.profit_per_unit

        # Level C: CustomerConfiguration
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()
        default_cost: float | None = cc.cost_per_unit if cc else None
        default_profit: float | None = cc.profit_per_unit if cc else None

        # Level D: global Configuration (only if still missing values)
        if default_cost is None or default_profit is None:
            result = await self.session.execute(
                select(Configuration).where(Configuration.id == _CONFIGURATION_SINGLETON_ID)
            )
            gc = result.scalar_one_or_none()
            if gc:
                if default_cost is None:
                    default_cost = gc.cost_per_unit
                if default_profit is None:
                    default_profit = gc.profit_per_unit

        # Level A: FinancialDate + OutletFinancialDate overrides
        # Outer join fetches only this outlet's override row (or NULL if none).
        stmt = (
            select(FinancialDate, OutletFinancialDate)
            .outerjoin(
                OutletFinancialDate,
                and_(
                    OutletFinancialDate.financial_date_id == FinancialDate.id,
                    OutletFinancialDate.outlet_id == outlet_id,
                    OutletFinancialDate.active.is_(True),
                ),
            )
            .where(
                FinancialDate.customer_id == customer_id,
                FinancialDate.active.is_(True),
                FinancialDate.end_date >= start_date,
                FinancialDate.start_date <= end_date,
            )
        )
        result = await self.session.execute(stmt)
        fd_rows = result.all()  # list of (FinancialDate, OutletFinancialDate | None)

        # Resolve cost and profit for every date in the range
        cost_map: dict[date, float] = {}
        profit_map: dict[date, float] = {}
        current = start_date
        while current <= end_date:
            weekday = current.weekday() + 1  # 1=Mon, 7=Sun

            # Level A: find a matching FinancialDate with an outlet-specific override
            override_cost: float | None = None
            override_profit: float | None = None
            for fd, ofd in fd_rows:
                if fd.weekday == weekday and fd.start_date <= current <= fd.end_date and ofd is not None:
                    if ofd.cost_per_unit is not None:
                        override_cost = ofd.cost_per_unit
                    if ofd.profit_per_unit is not None:
                        override_profit = ofd.profit_per_unit
                    break

            cost = override_cost if override_cost is not None else weekday_cost.get(weekday, default_cost)
            profit = override_profit if override_profit is not None else weekday_profit.get(weekday, default_profit)

            if cost is not None:
                cost_map[current] = cost
            if profit is not None:
                profit_map[current] = profit

            current += timedelta(days=1)

        covariates: dict[str, dict[date, float]] = {}
        if cost_map:
            covariates["cost_per_unit"] = cost_map
        if profit_map:
            covariates["profit_per_unit"] = profit_map

        return covariates or None

    async def _build_pad_covariates(
        self, customer_id: str
    ) -> dict[str, set[date]] | None:
        """Build pad event date sets for use as dynamic binary covariates.

        Returns a dict mapping pad feature name to the set of event dates,
        or None if no active pads with dates exist for this customer.

        The feature name uses the pad ID to guarantee uniqueness.
        Ridge regression learns the per-outlet sales effect for each event
        from the historical occurrences and applies it to future dates.
        """
        result = await self.session.execute(
            select(Pad).where(
                Pad.customer_id == customer_id,
                Pad.active.is_(True),
            )
        )
        pads = list(result.scalars().all())
        if not pads:
            return None

        pad_map: dict[str, set[date]] = {}
        for pad in pads:
            event_dates = {pd.date for pd in pad.dates if pd.active}
            if event_dates:
                pad_map[f"pad_{pad.id}"] = event_dates

        return pad_map or None

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
