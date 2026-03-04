"""Simulation service — runs predictions over a historic period and compares to actuals."""

import time
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()

from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_group import OutletGroupMember
from gorm_ai.database.models.pad import Pad
from gorm_ai.prediction.registry import EngineRegistry
from gorm_ai.schemas.prediction import PredictionEngine
from gorm_ai.schemas.simulation import (
    OutletSimulationResult,
    SimulationDayResult,
    SimulationGroup,
    SimulationRequest,
    SimulationResponse,
)
from gorm_ai.services.prediction import PredictionService
from gorm_ai.services.sales import SalesService

_CONFIGURATION_SINGLETON_ID = "00000000-0000-0000-0000-000000000001"


class SimulationService:
    """Runs historic simulations to assess prediction quality and financial impact."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.sales_service = SalesService(session)
        self.engine_registry = EngineRegistry()
        self._prediction_service = PredictionService(session)

    async def run_simulation(self, request: SimulationRequest) -> SimulationResponse:
        """Run the simulation and return classified results per outlet per day."""
        simulation_id = str(uuid4())
        started_at = time.monotonic()

        engine_type = await self._resolve_engine(request.customer_id, request.engine)
        engine = self.engine_registry.get_engine(engine_type)
        capabilities = engine.get_capabilities()

        outlet_ids = await self._resolve_outlets(
            request.customer_id, request.outlet_ids, request.outlet_group_id
        )

        n_chunks = (
            (request.simulation_to - request.simulation_from).days // 7 + 1
        )

        log.info(
            "simulation.start",
            simulation_id=simulation_id,
            customer_id=request.customer_id,
            engine=engine_type.value,
            simulation_from=str(request.simulation_from),
            simulation_to=str(request.simulation_to),
            delay_days=request.delay,
            outlet_count=len(outlet_ids),
            week_chunks=n_chunks,
            use_financials=request.use_financials,
            use_pad=request.use_pad,
        )

        # Cache financial data per outlet — used for both covariates and profit calc.
        # Build for a range wide enough to cover max TimesFM history + simulation window.
        cov_start = request.simulation_from - timedelta(days=1100)
        cov_end = request.simulation_to
        covariates_cache: dict[str, dict[str, dict[date, float]] | None] = {}
        for outlet_id in outlet_ids:
            covariates_cache[outlet_id] = (
                await self._prediction_service._build_covariates(
                    outlet_id, request.customer_id, cov_start, cov_end
                )
                if request.use_financials
                else None
            )

        # Pad event dates are customer-level; effect learned per outlet by Ridge
        pad_covariates = (
            await self._prediction_service._build_pad_covariates(request.customer_id)
            if request.use_pad
            else None
        )

        # Fallback financials from customer/global config
        default_cost, default_profit = await self._get_default_financials(request.customer_id)

        # Collect per-outlet day results across all week chunks
        outlet_days: dict[str, list[SimulationDayResult]] = {oid: [] for oid in outlet_ids}

        chunk_start = request.simulation_from
        chunk_num = 0
        while chunk_start <= request.simulation_to:
            chunk_num += 1
            chunk_end = min(chunk_start + timedelta(days=6), request.simulation_to)
            horizon = (chunk_end - chunk_start).days + 1
            history_cutoff = chunk_start - timedelta(days=request.delay)

            for outlet_id in outlet_ids:
                historical_sales = await self.sales_service.get_by_date_range(
                    customer_id=request.customer_id,
                    outlet_id=outlet_id,
                    end_date=history_cutoff,
                    apply_sales_filter=True,
                )
                historical_data = [
                    {"date": s.date, "value": s.sold} for s in historical_sales
                ]

                if len(historical_data) < capabilities.min_history_length:
                    continue  # not enough history for this outlet yet

                if (
                    capabilities.max_history_length
                    and len(historical_data) > capabilities.max_history_length
                ):
                    historical_data = historical_data[-capabilities.max_history_length :]

                covariates = covariates_cache[outlet_id]

                predictions = await engine.predict(
                    historical_data=historical_data,
                    horizon=horizon,
                    prediction_from=chunk_start,
                    covariates=covariates,
                    pad_dates=pad_covariates,
                )

                # Fetch actual data for the chunk window
                actual_sales = await self.sales_service.get_by_date_range(
                    customer_id=request.customer_id,
                    outlet_id=outlet_id,
                    start_date=chunk_start,
                    end_date=chunk_end,
                )
                actual_by_date = {s.date: s for s in actual_sales}

                for pred in predictions:
                    actual = actual_by_date.get(pred.date)
                    actual_draw = (
                        float(actual.delivered)
                        if actual and actual.delivered is not None
                        else None
                    )
                    actual_sale = float(actual.sold) if actual and actual.sold is not None else None

                    weekday = pred.date.weekday() + 1  # 1=Monday, 7=Sunday
                    cost, profit_unit = self._financial_for_date(
                        pred.date, covariates, default_cost, default_profit
                    )

                    group, profit_impact, potential_profit = self._classify(
                        pred.predicted_value, actual_draw, actual_sale, cost, profit_unit
                    )

                    # Parallel classification using the Newsvendor-adjusted draw
                    eco_group, eco_profit_impact, eco_potential_profit = (
                        self._classify(pred.economic_optimal, actual_draw, actual_sale, cost, profit_unit)
                        if pred.economic_optimal is not None
                        else (None, None, None)
                    )

                    day_result = SimulationDayResult(
                        date=pred.date,
                        weekday=weekday,
                        predicted_draw=pred.predicted_value,
                        group=group,
                        profit_impact=profit_impact,
                        potential_profit=potential_profit,
                        economic_optimal=pred.economic_optimal,
                        eco_group=eco_group,
                        eco_profit_impact=eco_profit_impact,
                        eco_potential_profit=eco_potential_profit,
                        actual_draw=actual_draw,
                        actual_sale=actual_sale,
                    )
                    outlet_days[outlet_id].append(day_result)

                    log.debug(
                        "simulation.date",
                        simulation_id=simulation_id,
                        outlet_id=outlet_id,
                        date=str(pred.date),
                        weekday=weekday,
                        predicted_draw=round(pred.predicted_value, 4),
                        economic_optimal=round(pred.economic_optimal, 4) if pred.economic_optimal is not None else None,
                        actual_draw=actual_draw,
                        actual_sale=actual_sale,
                        group=int(group) if group is not None else None,
                        eco_group=int(eco_group) if eco_group is not None else None,
                        profit_impact=round(profit_impact, 4) if profit_impact is not None else None,
                        eco_profit_impact=round(eco_profit_impact, 4) if eco_profit_impact is not None else None,
                    )

            log.info(
                "simulation.chunk",
                simulation_id=simulation_id,
                chunk=chunk_num,
                total_chunks=n_chunks,
                chunk_start=str(chunk_start),
                chunk_end=str(chunk_end),
            )

            chunk_start += timedelta(days=7)

        # Aggregate results
        outlet_results: list[OutletSimulationResult] = []
        total_profit = 0.0
        total_potential = 0.0
        agg_group_counts: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}
        eco_total_profit = 0.0
        eco_total_potential = 0.0
        eco_agg_group_counts: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}

        for outlet_id in outlet_ids:
            days = outlet_days[outlet_id]
            if not days:
                continue

            outlet_profit = sum(d.profit_impact for d in days if d.profit_impact is not None)
            outlet_potential = sum(d.potential_profit for d in days if d.potential_profit is not None)
            group_counts: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}
            for d in days:
                if d.group is not None:
                    group_counts[int(d.group)] += 1
                    agg_group_counts[int(d.group)] += 1

            eco_outlet_profit = sum(d.eco_profit_impact for d in days if d.eco_profit_impact is not None)
            eco_outlet_potential = sum(d.eco_potential_profit for d in days if d.eco_potential_profit is not None)
            eco_group_counts: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}
            for d in days:
                if d.eco_group is not None:
                    eco_group_counts[int(d.eco_group)] += 1
                    eco_agg_group_counts[int(d.eco_group)] += 1

            outlet_results.append(
                OutletSimulationResult(
                    outlet_id=outlet_id,
                    days=days,
                    total_profit_impact=outlet_profit,
                    potential_additional_profit=outlet_potential,
                    group_counts=group_counts,
                    eco_total_profit_impact=eco_outlet_profit,
                    eco_potential_additional_profit=eco_outlet_potential,
                    eco_group_counts=eco_group_counts,
                )
            )
            total_profit += outlet_profit
            total_potential += outlet_potential
            eco_total_profit += eco_outlet_profit
            eco_total_potential += eco_outlet_potential

        total_days = sum(len(o.days) for o in outlet_results)
        duration = round(time.monotonic() - started_at, 1)

        log.info(
            "simulation.complete",
            simulation_id=simulation_id,
            customer_id=request.customer_id,
            engine=engine_type.value,
            simulation_from=str(request.simulation_from),
            simulation_to=str(request.simulation_to),
            outlets_processed=len(outlet_results),
            total_days=total_days,
            duration_seconds=duration,
            # Baseline
            total_profit_impact=round(total_profit, 2),
            potential_additional_profit=round(total_potential, 2),
            net=round(total_profit + total_potential, 2),
            group_counts={str(k): v for k, v in agg_group_counts.items()},
            # Economic optimal
            eco_total_profit_impact=round(eco_total_profit, 2),
            eco_potential_additional_profit=round(eco_total_potential, 2),
            eco_net=round(eco_total_profit + eco_total_potential, 2),
            eco_group_counts={str(k): v for k, v in eco_agg_group_counts.items()},
        )

        response_id = str(uuid4())
        return SimulationResponse(
            id=response_id,
            customer_id=request.customer_id,
            simulation_from=request.simulation_from,
            simulation_to=request.simulation_to,
            delay=request.delay,
            engine=engine_type.value,
            outlets=outlet_results,
            total_profit_impact=total_profit,
            potential_additional_profit=total_potential,
            group_counts=agg_group_counts,
            eco_total_profit_impact=eco_total_profit,
            eco_potential_additional_profit=eco_total_potential,
            eco_group_counts=eco_agg_group_counts,
            created_at=datetime.now(UTC),
        )

    # -------------------------------------------------------------------------
    # Classification
    # -------------------------------------------------------------------------

    def _classify(
        self,
        predicted: float,
        actual_draw: float | None,
        actual_sale: float | None,
        cost_per_unit: float | None,
        profit_per_unit: float | None,
    ) -> tuple[SimulationGroup | None, float | None, float | None]:
        """Classify a single day into one of 4 groups and compute profit impact.

        Returns (group, profit_impact, potential_profit).
        profit_impact is None for group 4.
        potential_profit is only set for group 4 (upper-bound estimate).
        """
        if actual_draw is None or actual_sale is None:
            return None, None, None

        cost = cost_per_unit or 0.0
        profit = profit_per_unit or 0.0
        sold_out = actual_sale >= actual_draw

        if predicted < actual_draw:
            reduction = actual_draw - predicted
            if predicted >= actual_sale:
                # Group 1: good reduction — we'd deliver fewer, no lost sales
                return SimulationGroup.GOOD_REDUCTION, reduction * cost, None
            else:
                # Group 2: we'd deliver fewer but below actual sales — lost sales
                lost_sales = actual_sale - predicted
                return (
                    SimulationGroup.BAD_REDUCTION,
                    reduction * cost - lost_sales * profit,
                    None,
                )

        elif predicted > actual_draw:
            increase = predicted - actual_draw
            if sold_out:
                # Group 4: good increase — outlet sold out, extra copies might sell
                return SimulationGroup.GOOD_INCREASE, None, increase * profit
            else:
                # Group 3: bad increase — we'd deliver more than they could sell
                return SimulationGroup.BAD_INCREASE, -(increase * cost), None

        # predicted == actual_draw: neutral
        return None, 0.0, None

    # -------------------------------------------------------------------------
    # Financial data helpers
    # -------------------------------------------------------------------------

    def _financial_for_date(
        self,
        pred_date: date,
        covariates: dict[str, dict[date, float]] | None,
        default_cost: float | None,
        default_profit: float | None,
    ) -> tuple[float | None, float | None]:
        """Return (cost_per_unit, profit_per_unit) for a specific date."""
        if covariates:
            cost = covariates.get("cost_per_unit", {}).get(pred_date, default_cost)
            profit = covariates.get("profit_per_unit", {}).get(pred_date, default_profit)
            return cost, profit
        return default_cost, default_profit

    async def _get_default_financials(
        self, customer_id: str
    ) -> tuple[float | None, float | None]:
        """Fallback cost/profit from customer configuration → global configuration."""
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()
        if cc and (cc.cost_per_unit is not None or cc.profit_per_unit is not None):
            return cc.cost_per_unit, cc.profit_per_unit

        result = await self.session.execute(
            select(Configuration).where(Configuration.id == _CONFIGURATION_SINGLETON_ID)
        )
        gc = result.scalar_one_or_none()
        if gc:
            return gc.cost_per_unit, gc.profit_per_unit

        return None, None

    # -------------------------------------------------------------------------
    # Resolution helpers
    # -------------------------------------------------------------------------

    async def _resolve_outlets(
        self,
        customer_id: str,
        outlet_ids: list[str] | None,
        outlet_group_id: str | None,
    ) -> list[str]:
        if outlet_ids:
            return outlet_ids
        if outlet_group_id:
            result = await self.session.execute(
                select(OutletGroupMember.outlet_id).where(
                    OutletGroupMember.group_id == outlet_group_id,
                    OutletGroupMember.active.is_(True),
                )
            )
            return list(result.scalars().all())
        result = await self.session.execute(
            select(Outlet.id).where(
                Outlet.customer_id == customer_id,
                Outlet.active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def _resolve_engine(
        self, customer_id: str, engine_slug: str | None
    ) -> PredictionEngine:
        if engine_slug is not None:
            return PredictionEngine(engine_slug)
        return await self._prediction_service._resolve_engine(customer_id, None)
