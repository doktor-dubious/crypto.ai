"""Simulation service — runs predictions over a historic period and compares to actuals."""

import math
import time
from collections.abc import Callable, Coroutine
from datetime import UTC, date, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()


from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_group import OutletGroupMember
from gorm_ai.database.models.prediction import Prediction as PredictionModel
from gorm_ai.database.models.prediction_outlet import PredictionOutlet
from gorm_ai.database.models.sales import Sales
from gorm_ai.database.models.simulation import Simulation as SimulationModel
from gorm_ai.database.models.simulation_date import SimulationDate as SimulationDateModel
from gorm_ai.prediction.registry import EngineRegistry
from gorm_ai.schemas.prediction import PredictionEngine, PredictionResult
from gorm_ai.schemas.simulation import (
    OutletSimulationResult,
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

    async def run_simulation(
        self,
        request: SimulationRequest,
        task_id: str | None = None,
        on_progress: Callable[[int, str], Coroutine[Any, Any, None]] | None = None,
    ) -> SimulationResponse:
        """Run the simulation and return classified results per outlet per day."""
        started_at = time.monotonic()

        # Load strategy and apply its columns as defaults (request params take precedence)
        strategy_engine_slug: str | None = None
        if request.prediction_strategy_id:
            strategy = await self._prediction_service._load_strategy(request.prediction_strategy_id)
            if strategy:
                defaults = PredictionService._strategy_defaults(strategy)
                updates = {k: v for k, v in defaults.items() if getattr(request, k, None) in (None, False)}
                if updates:
                    request = request.model_copy(update=updates)
                if strategy.prediction_engine:
                    strategy_engine_slug = strategy.prediction_engine.slug

        is_same_draw = request.simulation_type == 3

        engine_type = await self._resolve_engine(request.customer_id, request.engine, strategy_engine_slug)
        engine = self.engine_registry.get_engine(engine_type)
        resolved_engine_params = await self._prediction_service._apply_engine_parameters(engine, engine_type.value)
        capabilities = engine.get_capabilities()

        outlet_ids = await self._resolve_outlets(
            request.customer_id, request.outlet_ids, request.outlet_group_id
        )

        n_chunks = (
            (request.simulation_to - request.simulation_from).days // 7 + 1
        )

        # --- Create the Simulation DB record before running ---
        sim_record = SimulationModel(
            customer_id=request.customer_id,
            name=request.name or f"Simulation {request.simulation_from} – {request.simulation_to}",
            description=request.description,
            prediction_strategy_id=request.prediction_strategy_id,
            started_at=datetime.now(UTC),
            outlet_ids=outlet_ids,
            simulation_from=request.simulation_from,
            simulation_to=request.simulation_to,
            delay=request.delay,
            engine="same_draw" if is_same_draw else engine_type.value,
            engine_params=resolved_engine_params or None,
            task_id=task_id,
            outlet_group_id=request.outlet_group_id,
        )
        self.session.add(sim_record)
        await self.session.flush()
        await self.session.commit()

        log.info(
            "simulation.start",
            simulation_id=sim_record.id,
            customer_id=request.customer_id,
            engine=sim_record.engine,
            simulation_from=str(request.simulation_from),
            simulation_to=str(request.simulation_to),
            delay_days=request.delay,
            outlet_count=len(outlet_ids),
            week_chunks=n_chunks,
            use_financials=request.use_financials,
            use_pad=request.use_pad,
        )

        # Store identity before chunk loop — expunge_all() will detach sim_record
        sim_record_id = sim_record.id
        sim_record_created_at = sim_record.created_at

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

        # Delivery constraints for all outlets (used when persisting prediction_outlets)
        delivery_map = await self._prediction_service._load_outlet_deliveries(outlet_ids)
        rounding = await self._prediction_service._resolve_rounding(request.customer_id)
        weekday_correction = await self._prediction_service._resolve_weekday_correction(request.customer_id)
        weekday_profile_params = await self._prediction_service._resolve_weekday_profile_correction(request.customer_id)
        weekday_only_flags = await self._prediction_service._resolve_weekday_only(request.customer_id)

        # Per-outlet scalar accumulators — avoids holding all SimulationDayResult objects in RAM
        outlet_profit_acc: dict[str, float] = {oid: 0.0 for oid in outlet_ids}
        outlet_potential_acc: dict[str, float] = {oid: 0.0 for oid in outlet_ids}
        outlet_group_counts_acc: dict[str, dict[int, int]] = {oid: {1: 0, 2: 0, 3: 0, 4: 0} for oid in outlet_ids}
        outlet_eco_profit_acc: dict[str, float] = {oid: 0.0 for oid in outlet_ids}
        outlet_eco_potential_acc: dict[str, float] = {oid: 0.0 for oid in outlet_ids}
        outlet_eco_group_counts_acc: dict[str, dict[int, int]] = {oid: {1: 0, 2: 0, 3: 0, 4: 0} for oid in outlet_ids}
        outlet_has_data: set[str] = set()
        total_days_processed = 0

        # Stats accumulators
        actual_total_delivered = 0.0
        actual_total_sale = 0.0
        actual_total_returned = 0.0

        delivered_total_delivered = 0.0
        delivered_total_sold = 0.0
        delivered_total_returned = 0.0

        pred_g_profit: dict[int, float] = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        pred_total_delivered = 0.0
        pred_total_sold = 0.0
        p_diff_delivered_total = 0
        p_diff_return_total = 0
        p_lost_sale_total = 0
        p_more_sale_total = 0

        eo_g_profit: dict[int, float] = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        eo_total_delivered = 0.0
        eo_total_sold = 0.0
        eo_diff_delivered_total = 0
        eo_diff_return_total = 0
        eo_lost_sale_total = 0
        eo_more_sale_total = 0

        delivered_diff_delivered_total = 0
        delivered_diff_return_total = 0
        delivered_loss_sale_total = 0
        delivered_more_sale_total = 0
        deliv_g_profit: dict[int, float] = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}

        chunk_start = request.simulation_from
        chunk_num = 0
        while chunk_start <= request.simulation_to:
            chunk_num += 1
            chunk_end = min(chunk_start + timedelta(days=6), request.simulation_to)
            horizon = (chunk_end - chunk_start).days + 1
            history_cutoff = chunk_start - timedelta(days=request.delay)

            if on_progress and n_chunks > 0:
                total_sim_days = (request.simulation_to - request.simulation_from).days + 1
                days_done = (chunk_end - request.simulation_from).days + 1
                pct = max(1, min(99, round((chunk_num - 1) / n_chunks * 100)))
                await on_progress(pct, f"{days_done}/{total_sim_days} days")

            # --- Collect per-outlet inputs for this chunk ---
            batch_outlet_ids: list[str] = []
            outlet_historical: dict[str, list[dict]] = {}

            batch_items: list[dict] = []
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
                    continue

                if (
                    capabilities.max_history_length
                    and len(historical_data) > capabilities.max_history_length
                ):
                    historical_data = historical_data[-capabilities.max_history_length :]

                outlet_historical[outlet_id] = historical_data
                batch_items.append({
                    "historical_data": historical_data,
                    "covariates": covariates_cache[outlet_id],
                    "pad_dates": pad_covariates,
                    "weekday_correction": weekday_correction,
                    "weekday_profile_correction": weekday_profile_params,
                })
                batch_outlet_ids.append(outlet_id)

            # --- Single batched prediction call for all outlets in this chunk ---
            all_predictions: list[list[PredictionResult]] = await engine.predict_batch(
                batch_items, horizon, chunk_start, batch_size=request.batch_size
            )

            # Weekday-only override: for dates whose weekday has weekday_only=True,
            # re-run predict_batch with history filtered to that weekday only.
            chunk_dates = [chunk_start + timedelta(days=i) for i in range(horizon)]
            wo_dates_in_chunk = [d for d in chunk_dates if weekday_only_flags[d.weekday()]]
            if wo_dates_in_chunk and batch_outlet_ids:
                date_to_idx = {d: i for i, d in enumerate(chunk_dates)}
                outlet_to_idx = {oid: i for i, oid in enumerate(batch_outlet_ids)}
                for wo_date in wo_dates_in_chunk:
                    target_wd = wo_date.weekday()
                    wo_items: list[dict] = []
                    wo_ids: list[str] = []
                    for outlet_id in batch_outlet_ids:
                        filtered = [
                            row for row in outlet_historical[outlet_id]
                            if row["date"].weekday() == target_wd
                        ]
                        if len(filtered) < capabilities.min_history_length:
                            continue
                        wo_items.append({
                            "historical_data": filtered,
                            "covariates": covariates_cache[outlet_id],
                            "pad_dates": pad_covariates,
                            "weekday_correction": [False] * 7,
                        })
                        wo_ids.append(outlet_id)
                    if not wo_items:
                        continue
                    wo_results = await engine.predict_batch(
                        wo_items, 1, wo_date, batch_size=request.batch_size
                    )
                    ri = date_to_idx[wo_date]
                    for wo_oid, wo_res in zip(wo_ids, wo_results):
                        if wo_res:
                            all_predictions[outlet_to_idx[wo_oid]][ri] = wo_res[0]

            ridge_results = getattr(engine, "_last_ridge_results", None)
            chunk_weekday_corrections: dict[str, dict[int, float]] = {}
            if ridge_results:
                chunk_weekday_corrections = PredictionService._extract_weekday_corrections(
                    batch_outlet_ids, ridge_results
                )
            actual_engine = "same_draw" if is_same_draw else (engine.get_actual_slug() or engine_type.value)

            # Same Draw: compute per-date sum(delivered) across all outlets in the chunk
            same_draw_totals: dict[date, int] = {}
            if is_same_draw:
                for outlet_id in batch_outlet_ids:
                    chunk_sales = await self.sales_service.get_by_date_range(
                        customer_id=request.customer_id,
                        outlet_id=outlet_id,
                        start_date=chunk_start,
                        end_date=chunk_end,
                    )
                    for s in chunk_sales:
                        if s.delivered is not None:
                            same_draw_totals[s.date] = same_draw_totals.get(s.date, 0) + int(s.delivered)

            # --- Persist one Prediction + PredictionOutlets per date in this chunk ---
            # date_outlet_delivered stores final delivered quantities for use in the accumulation block
            date_outlet_delivered: dict[date, dict[str, int]] = {}
            if batch_outlet_ids:
                date_outlet: dict = {}
                for outlet_id, results in zip(batch_outlet_ids, all_predictions):
                    for r in results:
                        date_outlet.setdefault(r.date, {})[outlet_id] = r

                # Load actuals for all outlet/date combinations in this chunk
                chunk_dates = list(date_outlet.keys())
                actuals_result = await self.session.execute(
                    select(Sales.outlet_id, Sales.date, Sales.sold)
                    .where(
                        Sales.outlet_id.in_(batch_outlet_ids),
                        Sales.date.in_(chunk_dates),
                        Sales.active.is_(True),
                    )
                )
                chunk_actuals: dict[tuple[date, str], float] = {
                    (row.date, row.outlet_id): float(row.sold)
                    for row in actuals_result.all()
                    if row.sold is not None
                }

                for pred_date, outlet_results in sorted(date_outlet.items()):
                    weekday = pred_date.weekday() + 1  # 1=Monday, 7=Sunday

                    pred_record = PredictionModel(
                        customer_id=request.customer_id,
                        outlet_ids=list(outlet_results.keys()),
                        date=pred_date,
                        delay=request.delay,
                        engine=actual_engine,
                        engine_params=resolved_engine_params or None,
                        use_financials=request.use_financials,
                        use_pad=request.use_pad,
                        batch_size=request.batch_size,
                    )
                    self.session.add(pred_record)
                    await self.session.flush()

                    # Compute final delivered quantity for each outlet on this date
                    outlet_delivered: dict[str, int] = {}
                    if is_same_draw:
                        # Same Draw: distribute the actual total delivered (sum across all outlets)
                        # via the engine's proportional prediction — same logic as fixed_total_delivery
                        outlets_data = [
                            (oid, r.predicted_value, r.lower_bound, r.upper_bound)
                            for oid, r in outlet_results.items()
                        ]
                        outlet_deliveries = {oid: delivery_map.get(oid, {}).get(weekday) for oid in outlet_results}
                        outlet_delivered = PredictionService._distribute_fixed_total(
                            outlets_data, outlet_deliveries, same_draw_totals.get(pred_date, 0),
                            ignore_fixed=request.ignore_fixed,
                            ignore_minimum=request.ignore_minimum,
                            ignore_maximum=request.ignore_maximum,
                        )
                    elif request.fixed_total_delivery is not None:
                        outlets_data = [
                            (oid, r.predicted_value, r.lower_bound, r.upper_bound)
                            for oid, r in outlet_results.items()
                        ]
                        outlet_deliveries = {oid: delivery_map.get(oid, {}).get(weekday) for oid in outlet_results}
                        outlet_delivered = PredictionService._distribute_fixed_total(
                            outlets_data, outlet_deliveries, request.fixed_total_delivery,
                            ignore_fixed=request.ignore_fixed,
                            ignore_minimum=request.ignore_minimum,
                            ignore_maximum=request.ignore_maximum,
                        )
                    elif request.total_return_pct is not None:
                        def _fin(oid: str, key: str) -> float | None:
                            cov = covariates_cache.get(oid)
                            return cov.get(key, {}).get(pred_date) if cov else None

                        outlets_data_fin = [
                            (
                                oid,
                                r.predicted_value, r.lower_bound, r.upper_bound,
                                _fin(oid, "cost_per_unit"),
                                _fin(oid, "profit_per_unit"),
                            )
                            for oid, r in outlet_results.items()
                        ]
                        outlet_deliveries = {oid: delivery_map.get(oid, {}).get(weekday) for oid in outlet_results}
                        outlet_delivered = PredictionService._distribute_for_total_return_pct(
                            outlets_data_fin, outlet_deliveries, request.total_return_pct,
                            default_cost=default_cost, default_profit=default_profit,
                            ignore_fixed=request.ignore_fixed,
                            ignore_minimum=request.ignore_minimum,
                            ignore_maximum=request.ignore_maximum,
                        )
                    else:
                        # Normal flow: base from _compute_delivered, then distribute any extras
                        for outlet_id, r in outlet_results.items():
                            delivery = delivery_map.get(outlet_id, {}).get(weekday)
                            effective_return_pct = (
                                (request.outlet_return_percentage or {}).get(outlet_id)
                                if request.outlet_return_percentage
                                else None
                            ) or request.target_return_pct
                            if effective_return_pct is not None:
                                base = PredictionService._delivered_for_return_pct(
                                    effective_return_pct, r.predicted_value, r.lower_bound, r.upper_bound
                                )
                                outlet_delivered[outlet_id], _ = self._prediction_service._compute_delivered(
                                    None, base, delivery, rounding,
                                    outlet_increase_num=float(request.increase_outlets_by or 0),
                                    outlet_increase_pct=float(request.increase_outlets_by_pct or 0),
                                    ignore_fixed=request.ignore_fixed,
                                    ignore_minimum=request.ignore_minimum,
                                    ignore_maximum=request.ignore_maximum,
                                )
                            else:
                                outlet_delivered[outlet_id], _ = self._prediction_service._compute_delivered(
                                    r.economic_optimal, r.predicted_value, delivery, rounding,
                                    outlet_increase_num=float(request.increase_outlets_by or 0),
                                    outlet_increase_pct=float(request.increase_outlets_by_pct or 0),
                                    ignore_fixed=request.ignore_fixed,
                                    ignore_minimum=request.ignore_minimum,
                                    ignore_maximum=request.ignore_maximum,
                                )
                        n_extra = request.increase_total_by or 0
                        if request.increase_total_by_pct:
                            n_extra += round(sum(outlet_delivered.values()) * request.increase_total_by_pct / 100)
                        if n_extra > 0:
                            outlets_data = [
                                (oid, r.predicted_value, r.lower_bound, r.upper_bound, float(outlet_delivered[oid]))
                                for oid, r in outlet_results.items()
                            ]
                            extras = PredictionService._distribute_extra_copies(outlets_data, n_extra)
                            for oid, extra in extras.items():
                                outlet_delivered[oid] += extra

                    date_outlet_delivered[pred_date] = dict(outlet_delivered)

                    for outlet_id, r in outlet_results.items():
                        delivery = delivery_map.get(outlet_id, {}).get(weekday)
                        oc = chunk_weekday_corrections.get(outlet_id, {})
                        self.session.add(PredictionOutlet(
                            prediction_id=pred_record.id,
                            outlet_id=outlet_id,
                            predicted=r.predicted_value,
                            lower_bound=r.lower_bound,
                            upper_bound=r.upper_bound,
                            confidence=r.confidence,
                            eo=r.economic_optimal,
                            delivered=outlet_delivered[outlet_id],
                            actual_sale=chunk_actuals.get((pred_date, outlet_id)),
                            fixed=delivery.fixed if delivery else None,
                            minimum=delivery.minimum if delivery else None,
                            maximum=delivery.maximum if delivery else None,
                            add=delivery.add if delivery else None,
                            add_pct=delivery.add_pct if delivery else None,
                            correction_mon=oc.get(1),
                            correction_tue=oc.get(2),
                            correction_wed=oc.get(3),
                            correction_thu=oc.get(4),
                            correction_fri=oc.get(5),
                            correction_sat=oc.get(6),
                            correction_sun=oc.get(7),
                        ))

                    self.session.add(SimulationDateModel(
                        simulation_id=sim_record.id,
                        prediction_id=pred_record.id,
                    ))

            # --- Fetch actuals and process results per outlet ---
            for outlet_id, predictions in zip(batch_outlet_ids, all_predictions):
                actual_sales = await self.sales_service.get_by_date_range(
                    customer_id=request.customer_id,
                    outlet_id=outlet_id,
                    start_date=chunk_start,
                    end_date=chunk_end,
                )
                actual_by_date = {s.date: s for s in actual_sales}
                covariates = covariates_cache[outlet_id]

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

                    eco_group, eco_profit_impact, eco_potential_profit = (
                        self._classify(pred.economic_optimal, actual_draw, actual_sale, cost, profit_unit)
                        if pred.economic_optimal is not None
                        else (None, None, None)
                    )

                    outlet_has_data.add(outlet_id)
                    total_days_processed += 1
                    if profit_impact is not None:
                        outlet_profit_acc[outlet_id] += profit_impact
                    if potential_profit is not None:
                        outlet_potential_acc[outlet_id] += potential_profit
                    if group is not None:
                        outlet_group_counts_acc[outlet_id][int(group)] += 1
                    if eco_profit_impact is not None:
                        outlet_eco_profit_acc[outlet_id] += eco_profit_impact
                    if eco_potential_profit is not None:
                        outlet_eco_potential_acc[outlet_id] += eco_potential_profit
                    if eco_group is not None:
                        outlet_eco_group_counts_acc[outlet_id][int(eco_group)] += 1

                    # Read final delivered quantity computed in the persistence block
                    adj_draw = float(date_outlet_delivered.get(pred.date, {}).get(outlet_id, 0))

                    # --- Accumulate actual (historical) totals ---
                    if actual_draw is not None and actual_sale is not None:
                        actual_total_delivered += actual_draw
                        actual_total_sale += actual_sale
                        actual_total_returned += max(0.0, actual_draw - actual_sale)

                    # --- Accumulate scenario stats ---
                    if actual_sale is not None:
                        delivered_total_delivered += round(adj_draw)
                        delivered_total_sold += round(min(adj_draw, actual_sale))
                        delivered_total_returned += round(max(0.0, adj_draw - actual_sale))

                    # prediction scenario: diff metrics + group profit (same logic as delivered, using rounded predicted)
                    if actual_draw is not None and actual_sale is not None:
                        p_draw = max(1, round(pred.predicted_value))
                        _cost = cost or 0.0
                        _profit = profit_unit or 0.0
                        actual_return_val_p = max(0.0, actual_draw - actual_sale)
                        sold_out_p = actual_return_val_p == 0.0

                        if p_draw < actual_sale:
                            p_sold_if = p_draw
                            p_return_if = 0.0
                            p_loss = round(p_draw - actual_sale)
                            p_more = 0
                        elif p_draw > actual_sale and sold_out_p:
                            p_sold_if = p_draw
                            p_return_if = 0.0
                            p_loss = 0
                            p_more = round(p_draw - actual_sale)
                        else:
                            p_sold_if = actual_sale
                            p_return_if = max(0.0, p_draw - actual_sale)
                            p_loss = 0
                            p_more = 0

                        pred_total_delivered += p_draw
                        pred_total_sold += p_sold_if
                        p_diff_delivered_total += round(p_draw - actual_draw)
                        p_diff_return_total += round(p_return_if - actual_return_val_p)
                        p_lost_sale_total += p_loss
                        p_more_sale_total += p_more

                        if p_draw < actual_draw:
                            reduction = actual_draw - p_draw
                            if p_draw >= actual_sale:
                                pred_g_profit[1] += reduction * _cost
                            else:
                                pred_g_profit[2] += reduction * _cost - (actual_sale - p_draw) * _profit
                        elif p_draw > actual_draw:
                            increase = p_draw - actual_draw
                            if sold_out_p:
                                pred_g_profit[4] += increase * _profit
                            else:
                                pred_g_profit[3] -= increase * _cost

                    # eo scenario: diff metrics + group profit (same logic as delivered, using rounded eo)
                    if actual_draw is not None and actual_sale is not None and pred.economic_optimal is not None:
                        if rounding == 2:
                            eo_draw = max(1, math.ceil(pred.economic_optimal))
                        elif rounding == 3:
                            eo_draw = max(1, math.floor(pred.economic_optimal))
                        else:
                            eo_draw = max(1, round(pred.economic_optimal))
                        _cost = cost or 0.0
                        _profit = profit_unit or 0.0
                        actual_return_val_eo = max(0.0, actual_draw - actual_sale)
                        sold_out_eo = actual_return_val_eo == 0.0

                        if eo_draw < actual_sale:
                            eo_sold_if = eo_draw
                            eo_return_if = 0.0
                            eo_loss = round(eo_draw - actual_sale)
                            eo_more = 0
                        elif eo_draw > actual_sale and sold_out_eo:
                            eo_sold_if = eo_draw
                            eo_return_if = 0.0
                            eo_loss = 0
                            eo_more = round(eo_draw - actual_sale)
                        else:
                            eo_sold_if = actual_sale
                            eo_return_if = max(0.0, eo_draw - actual_sale)
                            eo_loss = 0
                            eo_more = 0

                        eo_total_delivered += eo_draw
                        eo_total_sold += eo_sold_if
                        eo_diff_delivered_total += round(eo_draw - actual_draw)
                        eo_diff_return_total += round(eo_return_if - actual_return_val_eo)
                        eo_lost_sale_total += eo_loss
                        eo_more_sale_total += eo_more

                        if eo_draw < actual_draw:
                            reduction = actual_draw - eo_draw
                            if eo_draw >= actual_sale:
                                eo_g_profit[1] += reduction * _cost
                            else:
                                eo_g_profit[2] += reduction * _cost - (actual_sale - eo_draw) * _profit
                        elif eo_draw > actual_draw:
                            increase = eo_draw - actual_draw
                            if sold_out_eo:
                                eo_g_profit[4] += increase * _profit
                            else:
                                eo_g_profit[3] -= increase * _cost

                    # delivered scenario: diff metrics + group profit
                    if actual_draw is not None and actual_sale is not None:
                        _cost = cost or 0.0
                        _profit = profit_unit or 0.0
                        actual_return_val = max(0.0, actual_draw - actual_sale)
                        sold_out = actual_return_val == 0.0

                        if adj_draw < actual_sale:
                            # Under-delivery: delivery constrains sales → lost sales
                            sold_if_delivered = adj_draw
                            return_if_delivered = 0.0
                            loss_sale = round(adj_draw - actual_sale)  # negative
                            more_sale = 0
                        elif adj_draw > actual_sale and sold_out:
                            # Over-delivery into sold-out outlet: extra copies could sell
                            sold_if_delivered = adj_draw
                            return_if_delivered = 0.0
                            loss_sale = 0
                            more_sale = round(adj_draw - actual_sale)  # positive
                        else:
                            # Over-delivery but not sold out, or exact match
                            sold_if_delivered = actual_sale
                            return_if_delivered = max(0.0, adj_draw - actual_sale)
                            loss_sale = 0
                            more_sale = 0

                        delivered_diff_delivered_total += round(adj_draw - actual_draw)
                        delivered_diff_return_total += round(return_if_delivered - actual_return_val)
                        delivered_loss_sale_total += loss_sale
                        delivered_more_sale_total += more_sale

                        if adj_draw < actual_draw:
                            reduction = actual_draw - adj_draw
                            if adj_draw >= actual_sale:
                                # G1: good reduction — saves returns, no lost sales
                                deliv_g_profit[1] += reduction * _cost
                            else:
                                # G2: bad reduction — saves some cost but causes lost sales
                                lost_sales = actual_sale - adj_draw
                                deliv_g_profit[2] += reduction * _cost - lost_sales * _profit
                        elif adj_draw > actual_draw:
                            increase = adj_draw - actual_draw
                            if sold_out:
                                # G4: good increase — outlet was sold out, extra copies could sell
                                deliv_g_profit[4] += increase * _profit
                            else:
                                # G3: bad increase — outlet had unsold copies, extra copies wasted
                                deliv_g_profit[3] -= increase * _cost

                    log.debug(
                        "simulation.date",
                        simulation_id=sim_record.id,
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

            await self.session.commit()
            self.session.expunge_all()

            log.info(
                "simulation.chunk",
                simulation_id=sim_record_id,
                chunk=chunk_num,
                total_chunks=n_chunks,
                chunk_start=str(chunk_start),
                chunk_end=str(chunk_end),
                outlets_in_chunk=len(batch_outlet_ids),
            )

            chunk_start += timedelta(days=7)

        # Aggregate results per outlet from incremental accumulators
        outlet_results: list[OutletSimulationResult] = []
        total_profit = 0.0
        total_potential = 0.0
        agg_group_counts: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}
        eco_total_profit = 0.0
        eco_total_potential = 0.0
        eco_agg_group_counts: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}

        for outlet_id in outlet_ids:
            if outlet_id not in outlet_has_data:
                continue

            outlet_profit = outlet_profit_acc[outlet_id]
            outlet_potential = outlet_potential_acc[outlet_id]
            group_counts = outlet_group_counts_acc[outlet_id]
            eco_outlet_profit = outlet_eco_profit_acc[outlet_id]
            eco_outlet_potential = outlet_eco_potential_acc[outlet_id]
            eco_group_counts = outlet_eco_group_counts_acc[outlet_id]

            for g, cnt in group_counts.items():
                agg_group_counts[g] += cnt
            for g, cnt in eco_group_counts.items():
                eco_agg_group_counts[g] += cnt

            outlet_results.append(
                OutletSimulationResult(
                    outlet_id=outlet_id,
                    days=[],
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

        total_days = total_days_processed
        duration = round(time.monotonic() - started_at, 1)

        log.info(
            "simulation.complete",
            simulation_id=sim_record_id,
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

        # Re-fetch sim_record — it was expunged after each chunk commit
        sim_record = await self.session.get(SimulationModel, sim_record_id)

        # --- Persist aggregated stats to the Simulation record ---
        sim_record.ended_at = datetime.now(UTC)

        sim_record.actual_total_delivered = actual_total_delivered or None
        sim_record.actual_total_sale = actual_total_sale or None
        sim_record.actual_total_returned = actual_total_returned or None

        sim_record.d_total_delivered = delivered_total_delivered
        sim_record.d_total_sold = delivered_total_sold
        sim_record.d_total_returned = delivered_total_returned
        sim_record.d_diff_delivered = delivered_diff_delivered_total
        sim_record.d_diff_return = delivered_diff_return_total
        sim_record.d_lost_sale = delivered_loss_sale_total
        sim_record.d_more_sale = delivered_more_sale_total
        sim_record.d_g1 = deliv_g_profit[1] or None
        sim_record.d_g2 = deliv_g_profit[2] or None
        sim_record.d_g3 = deliv_g_profit[3] or None
        sim_record.d_g4 = deliv_g_profit[4] or None

        sim_record.p_total_delivered = pred_total_delivered
        sim_record.p_total_sold = pred_total_sold
        sim_record.p_total_returned = max(0.0, pred_total_delivered - pred_total_sold)
        sim_record.p_diff_delivered = p_diff_delivered_total
        sim_record.p_diff_return = p_diff_return_total
        sim_record.p_lost_sale = p_lost_sale_total
        sim_record.p_more_sale = p_more_sale_total
        sim_record.p_g1 = pred_g_profit[1] or None
        sim_record.p_g2 = pred_g_profit[2] or None
        sim_record.p_g3 = pred_g_profit[3] or None
        sim_record.p_g4 = pred_g_profit[4] or None

        if eo_total_delivered > 0:
            sim_record.eo_total_delivered = eo_total_delivered
            sim_record.eo_total_sold = eo_total_sold
            sim_record.eo_total_returned = max(0.0, eo_total_delivered - eo_total_sold)
            sim_record.eo_diff_delivered = eo_diff_delivered_total
            sim_record.eo_diff_return = eo_diff_return_total
            sim_record.eo_lost_sale = eo_lost_sale_total
            sim_record.eo_more_sale = eo_more_sale_total
            sim_record.eo_g1 = eo_g_profit[1] or None
            sim_record.eo_g2 = eo_g_profit[2] or None
            sim_record.eo_g3 = eo_g_profit[3] or None
            sim_record.eo_g4 = eo_g_profit[4] or None

        return SimulationResponse(
            id=sim_record.id,
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
            created_at=sim_record_created_at,
        )

    # -------------------------------------------------------------------------
    # List / delete
    # -------------------------------------------------------------------------

    async def list_completed(
        self,
        customer_id: str,
        limit: int = 500,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """List completed simulation tasks for a customer."""
        from gorm_ai.database.models.task_record import TaskRecord

        tr_result = await self.session.execute(
            select(TaskRecord)
            .where(
                TaskRecord.customer_id == customer_id,
                TaskRecord.type == "simulation",
                TaskRecord.status.in_(["success", "failure", "revoked"]),
                TaskRecord.active.is_(True),
            )
            .order_by(TaskRecord.completed_at.desc().nulls_last(), TaskRecord.created_at.desc())
        )
        task_records = list(tr_result.scalars().all())
        total = len(task_records)

        paged = task_records[offset : offset + limit]
        if not paged:
            return [], total

        task_ids = [tr.task_id for tr in paged if tr.task_id]
        sim_by_task: dict[str, SimulationModel] = {}
        deleted_task_ids: set[str] = set()
        if task_ids:
            sim_result = await self.session.execute(
                select(SimulationModel).where(
                    SimulationModel.task_id.in_(task_ids),
                )
            )
            for s in sim_result.scalars().all():
                if not s.task_id:
                    continue
                if s.active:
                    sim_by_task[s.task_id] = s
                else:
                    # Simulation was deleted but TaskRecord wasn't — clean up
                    deleted_task_ids.add(s.task_id)

        # Back-fill actual_total_sale for simulations that pre-date the column
        sims_needing_actual = [s for s in sim_by_task.values() if s.actual_total_sale is None and s.id]
        if sims_needing_actual:
            from sqlalchemy import func as sqlfunc

            from gorm_ai.database.models.simulation_date import SimulationDate
            rows = await self.session.execute(
                select(
                    SimulationDate.simulation_id,
                    sqlfunc.sum(PredictionOutlet.actual_sale).label("total_sale"),
                )
                .join(PredictionOutlet, PredictionOutlet.prediction_id == SimulationDate.prediction_id)
                .where(SimulationDate.simulation_id.in_([s.id for s in sims_needing_actual]))
                .group_by(SimulationDate.simulation_id)
            )
            actual_sale_by_sim: dict[str, float] = {row.simulation_id: row.total_sale for row in rows}
            for s in sims_needing_actual:
                s.actual_total_sale = actual_sale_by_sim.get(s.id)
                # Derive delivered and returned from stored delivered-scenario stats
                if s.d_total_delivered is not None and s.d_diff_delivered is not None:
                    s.actual_total_delivered = s.d_total_delivered - s.d_diff_delivered
                if s.actual_total_delivered is not None and s.actual_total_sale is not None:
                    s.actual_total_returned = max(0.0, s.actual_total_delivered - s.actual_total_sale)
            await self.session.flush()

        # Deactivate orphaned TaskRecords whose simulation was already deleted
        for tr in paged:
            if tr.task_id in deleted_task_ids:
                tr.active = False
        if deleted_task_ids:
            await self.session.flush()

        items: list[dict] = []
        for tr in paged:
            if tr.task_id in deleted_task_ids:
                continue
            sim = sim_by_task.get(tr.task_id) if tr.task_id else None
            outlet_count = len(sim.outlet_ids) if sim and sim.outlet_ids else 0
            items.append({
                "id": tr.id,
                "task_id": tr.task_id,
                "simulation_id": sim.id if sim else None,
                "status": tr.status,
                "customer_id": customer_id,
                "name": sim.name if sim else None,
                "description": sim.description if sim else None,
                "simulation_from": sim.simulation_from if sim else None,
                "simulation_to": sim.simulation_to if sim else None,
                "engine": sim.engine if sim else None,
                "delay": sim.delay if sim else None,
                "outlet_count": outlet_count,
                "outlet_group_id": sim.outlet_group_id if sim else None,
                "outlet_group_name": sim.outlet_group.name if sim and sim.outlet_group else None,
                "prediction_strategy_name": sim.prediction_strategy.name if sim and sim.prediction_strategy else None,
                "error": tr.error,
                "created_at": tr.created_at,
                "started_at": sim.started_at if sim else None,
                "ended_at": sim.ended_at if sim else None,
                "actual_total_delivered": sim.actual_total_delivered if sim else None,
                "actual_total_sale": sim.actual_total_sale if sim else None,
                "actual_total_returned": sim.actual_total_returned if sim else None,
                "d_total_delivered": sim.d_total_delivered if sim else None,
                "d_total_sold": sim.d_total_sold if sim else None,
                "d_total_returned": sim.d_total_returned if sim else None,
                "d_diff_delivered": sim.d_diff_delivered if sim else None,
                "d_diff_return": sim.d_diff_return if sim else None,
                "d_lost_sale": sim.d_lost_sale if sim else None,
                "d_more_sale": sim.d_more_sale if sim else None,
                "d_g1": sim.d_g1 if sim else None,
                "d_g2": sim.d_g2 if sim else None,
                "d_g3": sim.d_g3 if sim else None,
                "d_g4": sim.d_g4 if sim else None,
                "p_total_delivered": sim.p_total_delivered if sim else None,
                "p_total_sold": sim.p_total_sold if sim else None,
                "p_total_returned": sim.p_total_returned if sim else None,
                "p_diff_delivered": sim.p_diff_delivered if sim else None,
                "p_diff_return": sim.p_diff_return if sim else None,
                "p_lost_sale": sim.p_lost_sale if sim else None,
                "p_more_sale": sim.p_more_sale if sim else None,
                "p_g1": sim.p_g1 if sim else None,
                "p_g2": sim.p_g2 if sim else None,
                "p_g3": sim.p_g3 if sim else None,
                "p_g4": sim.p_g4 if sim else None,
                "eo_total_delivered": sim.eo_total_delivered if sim else None,
                "eo_total_sold": sim.eo_total_sold if sim else None,
                "eo_total_returned": sim.eo_total_returned if sim else None,
                "eo_diff_delivered": sim.eo_diff_delivered if sim else None,
                "eo_diff_return": sim.eo_diff_return if sim else None,
                "eo_lost_sale": sim.eo_lost_sale if sim else None,
                "eo_more_sale": sim.eo_more_sale if sim else None,
                "eo_g1": sim.eo_g1 if sim else None,
                "eo_g2": sim.eo_g2 if sim else None,
                "eo_g3": sim.eo_g3 if sim else None,
                "eo_g4": sim.eo_g4 if sim else None,
            })
        return items, total

    async def get_zero_shot(
        self,
        simulation_id: str,
        column: str = "delivered",
        weekdays: list[int] | None = None,
    ) -> dict | None:
        """Compute zero-shot accuracy counts for a simulation."""
        from sqlalchemy import Integer, case, extract, func

        from gorm_ai.database.models.prediction import Prediction as PredictionModel
        from gorm_ai.database.models.simulation_date import SimulationDate

        # Verify simulation exists
        sim = await self.session.get(SimulationModel, simulation_id)
        if not sim or not sim.active:
            return None

        _col_map = {
            "delivered":   PredictionOutlet.delivered,
            "eo":          PredictionOutlet.eo,
            "predicted":   PredictionOutlet.predicted,
            "upper_bound": PredictionOutlet.upper_bound,
            "lower_bound": PredictionOutlet.lower_bound,
        }
        col = _col_map.get(column, PredictionOutlet.delivered)
        d = func.round(col).cast(Integer)
        a = func.round(PredictionOutlet.actual_sale).cast(Integer)

        filters = [SimulationDate.simulation_id == simulation_id]
        if weekdays:
            filters.append(extract("isodow", PredictionModel.date).in_(weekdays))

        row = await self.session.execute(
            select(
                func.count(case((PredictionOutlet.actual_sale.isnot(None) & col.isnot(None) & (d == a),         1))).label("zero_shot"),
                func.count(case((PredictionOutlet.actual_sale.isnot(None) & col.isnot(None) & (d == a + 1),     1))).label("zero_shot_plus_1"),
                func.count(case((PredictionOutlet.actual_sale.isnot(None) & col.isnot(None) & (d == a - 1),     1))).label("zero_shot_minus_1"),
                func.count(case((PredictionOutlet.actual_sale.isnot(None) & col.isnot(None) & (d == a + 2),     1))).label("zero_shot_plus_2"),
                func.count(case((PredictionOutlet.actual_sale.isnot(None) & col.isnot(None) & (d == a - 2),     1))).label("zero_shot_minus_2"),
                func.count(case((PredictionOutlet.actual_sale.isnot(None) & col.isnot(None) & (d > a + 2),      1))).label("zero_shot_plus_mul"),
                func.count(case((PredictionOutlet.actual_sale.isnot(None) & col.isnot(None) & (d < a - 2),      1))).label("zero_shot_minus_mul"),
                func.count(case((PredictionOutlet.actual_sale.is_(None),    1))).label("no_actual_data"),
                func.count(PredictionOutlet.id).label("total"),
            )
            .join(SimulationDate, SimulationDate.prediction_id == PredictionOutlet.prediction_id)
            .join(PredictionModel, PredictionModel.id == PredictionOutlet.prediction_id)
            .where(*filters)
        )
        r = row.one()
        return {
            "zero_shot":          r.zero_shot,
            "zero_shot_plus_1":   r.zero_shot_plus_1,
            "zero_shot_minus_1":  r.zero_shot_minus_1,
            "zero_shot_plus_2":   r.zero_shot_plus_2,
            "zero_shot_minus_2":  r.zero_shot_minus_2,
            "zero_shot_plus_mul": r.zero_shot_plus_mul,
            "zero_shot_minus_mul": r.zero_shot_minus_mul,
            "no_actual_data":     r.no_actual_data,
            "total":              r.total,
        }

    async def get_accuracy_stats(
        self,
        simulation_id: str,
        column: str = "delivered",
        weekdays: list[int] | None = None,
    ) -> dict | None:
        """Compute statistical accuracy metrics (MAE, Bias, RMSE, MAPE, R²) for a simulation."""
        from sqlalchemy import Float, Integer, extract, func, literal

        from gorm_ai.database.models.prediction import Prediction as PredictionModel
        from gorm_ai.database.models.simulation_date import SimulationDate

        sim = await self.session.get(SimulationModel, simulation_id)
        if not sim or not sim.active:
            return None

        _col_map = {
            "delivered":   PredictionOutlet.delivered,
            "eo":          PredictionOutlet.eo,
            "predicted":   PredictionOutlet.predicted,
            "upper_bound": PredictionOutlet.upper_bound,
            "lower_bound": PredictionOutlet.lower_bound,
        }
        col = _col_map.get(column, PredictionOutlet.delivered)

        filters = [
            SimulationDate.simulation_id == simulation_id,
            PredictionOutlet.actual_sale.isnot(None),
            col.isnot(None),
        ]
        if weekdays:
            filters.append(extract("isodow", PredictionModel.date).in_(weekdays))

        pred_val = func.round(col).cast(Float)
        actual_val = PredictionOutlet.actual_sale.cast(Float)
        diff = pred_val - actual_val
        abs_diff = func.abs(diff)

        row = await self.session.execute(
            select(
                func.count(PredictionOutlet.id).label("cnt"),
                func.avg(abs_diff).label("mae"),
                func.avg(diff).label("bias"),
                func.sqrt(func.avg(diff * diff)).label("rmse"),
                # For R²: SS_tot = sum(actual²) - sum(actual)²/n
                func.sum(actual_val * actual_val).label("sum_actual_sq"),
                func.sum(actual_val).label("sum_actual"),
                # SS_res = sum((pred - actual)²)
                func.sum(diff * diff).label("ss_res"),
                # For MAPE: count nonzero actuals
                func.count(
                    func.nullif(actual_val, literal(0.0))
                ).label("nonzero_cnt"),
                # Sum of |diff|/actual only for nonzero actuals
                func.sum(
                    func.abs(diff) / func.nullif(actual_val, literal(0.0))
                ).label("ape_sum"),
            )
            .join(SimulationDate, SimulationDate.prediction_id == PredictionOutlet.prediction_id)
            .join(PredictionModel, PredictionModel.id == PredictionOutlet.prediction_id)
            .where(*filters)
        )
        r = row.one()

        cnt = r.cnt or 0
        if cnt == 0:
            return None

        mae = float(r.mae)
        bias = float(r.bias)
        rmse = float(r.rmse)

        # MAPE — computed over nonzero actuals only
        mape = None
        if r.nonzero_cnt and r.nonzero_cnt > 0 and r.ape_sum is not None:
            mape = float(r.ape_sum) / int(r.nonzero_cnt) * 100.0

        # R² = 1 - SS_res / SS_tot, where SS_tot = sum(a²) - sum(a)²/n
        r_squared = None
        if r.sum_actual_sq is not None and r.sum_actual is not None and cnt > 0:
            ss_tot = float(r.sum_actual_sq) - float(r.sum_actual) ** 2 / cnt
            if ss_tot > 0:
                r_squared = 1.0 - float(r.ss_res) / ss_tot

        return {
            "mae": round(mae, 4),
            "bias": round(bias, 4),
            "rmse": round(rmse, 4),
            "mape": round(mape, 2) if mape is not None else None,
            "r_squared": round(r_squared, 4) if r_squared is not None else None,
            "count": cnt,
        }

    async def delete_simulation(self, simulation_id: str) -> bool:
        """Soft-delete a simulation record."""
        result = await self.session.execute(
            select(SimulationModel).where(
                SimulationModel.id == simulation_id,
                SimulationModel.active.is_(True),
            )
        )
        sim = result.scalar_one_or_none()
        if not sim:
            return False
        sim.active = False

        # Also soft-delete the associated TaskRecord so it disappears from list_completed
        if sim.task_id:
            from gorm_ai.database.models.task_record import TaskRecord
            tr_result = await self.session.execute(
                select(TaskRecord).where(
                    TaskRecord.task_id == sim.task_id,
                    TaskRecord.active.is_(True),
                )
            )
            tr = tr_result.scalar_one_or_none()
            if tr:
                tr.active = False

        await self.session.flush()
        return True

    async def delete_by_record_id(self, record_id: str) -> bool:
        """Soft-delete a simulation by TaskRecord id (works even without a SimulationModel)."""
        from gorm_ai.database.models.task_record import TaskRecord

        tr_result = await self.session.execute(
            select(TaskRecord).where(
                TaskRecord.id == record_id,
                TaskRecord.active.is_(True),
            )
        )
        tr = tr_result.scalar_one_or_none()
        if not tr:
            return False
        tr.active = False

        # Also soft-delete all linked SimulationModel rows (task_id is not unique)
        if tr.task_id:
            sim_result = await self.session.execute(
                select(SimulationModel).where(
                    SimulationModel.task_id == tr.task_id,
                    SimulationModel.active.is_(True),
                )
            )
            for sim in sim_result.scalars().all():
                sim.active = False

        await self.session.flush()
        return True

    async def get_overview_filtered(
        self,
        simulation_id: str,
        column: str = "delivered",
        weekdays: list[int] | None = None,
    ) -> dict | None:
        """Re-aggregate overview stats for a simulation, optionally filtered by weekday.

        Includes actual totals and profit group (g1-g4) data computed via classification.
        """
        from sqlalchemy import extract

        from gorm_ai.database.models.outlet_financials import OutletFinancials
        from gorm_ai.database.models.prediction import Prediction as PredictionModel
        from gorm_ai.database.models.sales import Sales
        from gorm_ai.database.models.simulation_date import SimulationDate

        sim = await self.session.get(SimulationModel, simulation_id)
        if not sim or not sim.active:
            return None

        _col_attr = {
            "delivered":   PredictionOutlet.delivered,
            "eo":          PredictionOutlet.eo,
            "predicted":   PredictionOutlet.predicted,
            "upper_bound": PredictionOutlet.upper_bound,
            "lower_bound": PredictionOutlet.lower_bound,
        }
        col_attr = _col_attr.get(column, PredictionOutlet.delivered)

        filters = [SimulationDate.simulation_id == simulation_id]
        if weekdays:
            filters.append(extract("isodow", PredictionModel.date).in_(weekdays))

        # Load all relevant rows with actual delivery from sales
        rows_result = await self.session.execute(
            select(
                PredictionOutlet.outlet_id,
                extract("isodow", PredictionModel.date).label("weekday"),
                col_attr.label("scenario_delivery"),
                Sales.delivered.label("actual_delivered"),
                PredictionOutlet.actual_sale,
            )
            .join(SimulationDate, SimulationDate.prediction_id == PredictionOutlet.prediction_id)
            .join(PredictionModel, PredictionModel.id == PredictionOutlet.prediction_id)
            .outerjoin(Sales, (Sales.outlet_id == PredictionOutlet.outlet_id) & (Sales.date == PredictionModel.date))
            .where(*filters)
        )
        rows = rows_result.all()

        # Load financial data per outlet per weekday (OutletFinancials)
        outlet_ids = list({r.outlet_id for r in rows})
        financials_result = await self.session.execute(
            select(OutletFinancials.outlet_id, OutletFinancials.weekday,
                   OutletFinancials.cost_per_unit, OutletFinancials.profit_per_unit)
            .where(OutletFinancials.outlet_id.in_(outlet_ids))
        )
        fin_map: dict[tuple[str, int], tuple[float | None, float | None]] = {
            (r.outlet_id, r.weekday): (r.cost_per_unit, r.profit_per_unit)
            for r in financials_result
        }

        default_cost, default_profit = await self._get_default_financials(sim.customer_id)

        # Accumulators
        total_delivered = 0.0
        total_sold = 0.0
        total_returned = 0.0
        actual_total_delivered = 0.0
        actual_total_sale = 0.0
        actual_total_returned = 0.0
        diff_delivered_total = 0
        diff_return_total = 0
        lost_sale_total = 0
        more_sale_total = 0
        g_profit: dict[int, float] = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        has_scenario = False
        has_actual = False

        for r in rows:
            scenario_delivery = r.scenario_delivery
            actual_draw = float(r.actual_delivered) if r.actual_delivered is not None else None
            actual_sale = float(r.actual_sale) if r.actual_sale is not None else None

            if scenario_delivery is not None and actual_sale is not None:
                has_scenario = True
                s_draw = max(1, round(float(scenario_delivery)))

                # Use conservative sold/returned (matches run_simulation logic)
                total_delivered += s_draw
                total_sold += round(min(s_draw, actual_sale))
                total_returned += round(max(0.0, s_draw - actual_sale))

                # Diff metrics (require actual_draw)
                if actual_draw is not None:
                    actual_return_val = max(0.0, actual_draw - actual_sale)
                    sold_out = actual_return_val == 0.0

                    if s_draw < actual_sale:
                        s_return_if = 0.0
                        loss_sale = round(s_draw - actual_sale)  # negative
                        more_sale = 0
                    elif s_draw > actual_sale and sold_out:
                        s_return_if = 0.0
                        loss_sale = 0
                        more_sale = round(s_draw - actual_sale)  # positive
                    else:
                        s_return_if = max(0.0, s_draw - actual_sale)
                        loss_sale = 0
                        more_sale = 0

                    diff_delivered_total += round(s_draw - actual_draw)
                    diff_return_total += round(s_return_if - actual_return_val)
                    lost_sale_total += loss_sale
                    more_sale_total += more_sale

                    # G1-G4 profit classification
                    cost, profit_unit = fin_map.get((r.outlet_id, int(r.weekday)), (None, None))
                    if cost is None:
                        cost = default_cost
                    if profit_unit is None:
                        profit_unit = default_profit
                    _cost = cost or 0.0
                    _profit = profit_unit or 0.0
                    if s_draw < actual_draw:
                        reduction = actual_draw - s_draw
                        if s_draw >= actual_sale:
                            g_profit[1] += reduction * _cost
                        else:
                            g_profit[2] += reduction * _cost - (actual_sale - s_draw) * _profit
                    elif s_draw > actual_draw:
                        increase = s_draw - actual_draw
                        if sold_out:
                            g_profit[4] += increase * _profit
                        else:
                            g_profit[3] -= increase * _cost

            if actual_draw is not None and actual_sale is not None:
                has_actual = True
                actual_total_delivered += actual_draw
                actual_total_sale += actual_sale
                actual_total_returned += max(0.0, actual_draw - actual_sale)

        return {
            "total_delivered": total_delivered if has_scenario else None,
            "total_sold": total_sold if has_scenario else None,
            "total_returned": total_returned if has_scenario else None,
            "actual_total_delivered": actual_total_delivered if has_actual else None,
            "actual_total_sale": actual_total_sale if has_actual else None,
            "actual_total_returned": actual_total_returned if has_actual else None,
            "diff_delivered": diff_delivered_total if has_scenario else None,
            "diff_return": diff_return_total if has_scenario else None,
            "lost_sale": lost_sale_total if has_scenario else None,
            "more_sale": more_sale_total if has_scenario else None,
            "g1": g_profit[1] or None,
            "g2": g_profit[2] or None,
            "g3": g_profit[3] or None,
            "g4": g_profit[4] or None,
        }

    async def get_model_fit(
        self,
        simulation_id: str,
        outlet_ids: list[str] | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
        weekdays: list[int] | None = None,
    ) -> dict | None:
        """Return per-date aggregated actual_sale and delivered for a simulation."""
        from gorm_ai.database.models.outlet import Outlet
        from gorm_ai.database.models.simulation_date import SimulationDate

        sim = await self.session.get(SimulationModel, simulation_id)
        if not sim or not sim.active:
            return None

        # Fetch outlet names for the simulation
        sim_outlet_ids: list[str] = sim.outlet_ids or []
        outlets_result = await self.session.execute(
            select(Outlet.id, Outlet.name)
            .where(Outlet.id.in_(sim_outlet_ids))
            .order_by(Outlet.name)
        )
        outlets = [{"id": str(row.id), "name": row.name} for row in outlets_result.all()]

        # Build aggregated time series
        from sqlalchemy import extract, func

        from gorm_ai.database.models.prediction import Prediction as PredictionModel

        filters = [SimulationDate.simulation_id == simulation_id]
        if outlet_ids:
            filters.append(PredictionOutlet.outlet_id.in_(outlet_ids))
        if from_date:
            filters.append(PredictionModel.date >= from_date)
        if to_date:
            filters.append(PredictionModel.date <= to_date)
        if weekdays:
            filters.append(extract("isodow", PredictionModel.date).in_(weekdays))

        rows = await self.session.execute(
            select(
                PredictionModel.date,
                func.sum(PredictionOutlet.actual_sale).label("actual_sale"),
                func.sum(PredictionOutlet.delivered).label("delivered"),
                func.sum(PredictionOutlet.eo).label("eo"),
                func.sum(PredictionOutlet.predicted).label("predicted"),
                func.sum(PredictionOutlet.lower_bound).label("lower_bound"),
                func.sum(PredictionOutlet.upper_bound).label("upper_bound"),
            )
            .join(SimulationDate, SimulationDate.prediction_id == PredictionOutlet.prediction_id)
            .join(PredictionModel, PredictionModel.id == PredictionOutlet.prediction_id)
            .where(*filters)
            .group_by(PredictionModel.date)
            .order_by(PredictionModel.date)
        )

        data = [
            {
                "date": row.date,
                "actual_sale": row.actual_sale,
                "delivered": row.delivered,
                "eo": row.eo,
                "predicted": row.predicted,
                "lower_bound": row.lower_bound,
                "upper_bound": row.upper_bound,
            }
            for row in rows.all()
        ]

        return {"outlets": outlets, "data": data}

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
        self, customer_id: str, engine_slug: str | None, strategy_engine_slug: str | None = None
    ) -> PredictionEngine:
        if engine_slug is not None:
            return PredictionEngine(engine_slug)
        return await self._prediction_service._resolve_engine(customer_id, None, strategy_engine_slug)
