"""Simulation service — runs predictions over a historic period and compares to actuals."""

import time
from datetime import UTC, date, datetime, timedelta

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()

from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_group import OutletGroupMember
from gorm_ai.database.models.pad import Pad
from gorm_ai.database.models.prediction import Prediction as PredictionModel
from gorm_ai.database.models.prediction_outlet import PredictionOutlet
from gorm_ai.database.models.simulation import Simulation as SimulationModel
from gorm_ai.database.models.simulation_date import SimulationDate as SimulationDateModel
from gorm_ai.prediction.registry import EngineRegistry
from gorm_ai.schemas.prediction import PredictionEngine
from sqlalchemy.orm import selectinload
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

    async def run_simulation(
        self,
        request: SimulationRequest,
        task_id: str | None = None,
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

        engine_type = await self._resolve_engine(request.customer_id, request.engine, strategy_engine_slug)
        engine = self.engine_registry.get_engine(engine_type)
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
            name=f"Simulation {request.simulation_from} – {request.simulation_to}",
            started_at=datetime.now(UTC),
            outlet_ids=outlet_ids,
            simulation_from=request.simulation_from,
            simulation_to=request.simulation_to,
            delay=request.delay,
            engine=engine_type.value,
            task_id=task_id,
        )
        self.session.add(sim_record)
        await self.session.flush()
        await self.session.commit()

        log.info(
            "simulation.start",
            simulation_id=sim_record.id,
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

        # Delivery constraints for all outlets (used when persisting prediction_outlets)
        delivery_map = await self._prediction_service._load_outlet_deliveries(outlet_ids)
        rounding = await self._prediction_service._resolve_rounding(request.customer_id)

        # Collect per-outlet day results across all week chunks
        outlet_days: dict[str, list[SimulationDayResult]] = {oid: [] for oid in outlet_ids}

        # Stats accumulators
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

            # --- Collect per-outlet inputs for this chunk ---
            batch_items: list[dict] = []
            batch_outlet_ids: list[str] = []
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

                batch_items.append({
                    "historical_data": historical_data,
                    "covariates": covariates_cache[outlet_id],
                    "pad_dates": pad_covariates,
                })
                batch_outlet_ids.append(outlet_id)

            # --- Single batched prediction call for all outlets in this chunk ---
            all_predictions = await engine.predict_batch(
                batch_items, horizon, chunk_start, batch_size=request.batch_size
            )
            actual_engine = engine.get_actual_slug() or engine_type.value

            # --- Persist one Prediction + PredictionOutlets per date in this chunk ---
            # date_outlet_delivered stores final delivered quantities for use in the accumulation block
            date_outlet_delivered: dict[date, dict[str, int]] = {}
            if batch_outlet_ids:
                date_outlet: dict = {}
                for outlet_id, results in zip(batch_outlet_ids, all_predictions):
                    for r in results:
                        date_outlet.setdefault(r.date, {})[outlet_id] = r

                for pred_date, outlet_results in sorted(date_outlet.items()):
                    weekday = pred_date.weekday() + 1  # 1=Monday, 7=Sunday

                    pred_record = PredictionModel(
                        customer_id=request.customer_id,
                        outlet_ids=list(outlet_results.keys()),
                        date=pred_date,
                        delay=request.delay,
                        engine=actual_engine,
                        use_financials=request.use_financials,
                        use_pad=request.use_pad,
                        batch_size=request.batch_size,
                    )
                    self.session.add(pred_record)
                    await self.session.flush()

                    # Compute final delivered quantity for each outlet on this date
                    outlet_delivered: dict[str, int] = {}
                    if request.fixed_total_delivery is not None:
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
                                outlet_delivered[outlet_id] = self._prediction_service._compute_delivered(
                                    None, base, delivery, rounding,
                                    outlet_increase_num=float(request.increase_outlets_by or 0),
                                    outlet_increase_pct=float(request.increase_outlets_by_pct or 0),
                                    ignore_fixed=request.ignore_fixed,
                                    ignore_minimum=request.ignore_minimum,
                                    ignore_maximum=request.ignore_maximum,
                                )
                            else:
                                outlet_delivered[outlet_id] = self._prediction_service._compute_delivered(
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
                        self.session.add(PredictionOutlet(
                            prediction_id=pred_record.id,
                            outlet_id=outlet_id,
                            predicted=r.predicted_value,
                            lower_bound=r.lower_bound,
                            upper_bound=r.upper_bound,
                            confidence=r.confidence,
                            eo=r.economic_optimal,
                            delivered=outlet_delivered[outlet_id],
                            fixed=delivery.fixed if delivery else None,
                            minimum=delivery.minimum if delivery else None,
                            maximum=delivery.maximum if delivery else None,
                            add=delivery.add if delivery else None,
                            add_pct=delivery.add_pct if delivery else None,
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

                    # Read final delivered quantity computed in the persistence block
                    adj_draw = float(date_outlet_delivered.get(pred.date, {}).get(outlet_id, 0))

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

            log.info(
                "simulation.chunk",
                simulation_id=sim_record.id,
                chunk=chunk_num,
                total_chunks=n_chunks,
                chunk_start=str(chunk_start),
                chunk_end=str(chunk_end),
                outlets_in_chunk=len(batch_outlet_ids),
            )

            chunk_start += timedelta(days=7)

        # Aggregate results per outlet
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
            simulation_id=sim_record.id,
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

        # --- Persist aggregated stats to the Simulation record ---
        sim_record.ended_at = datetime.now(UTC)

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
            created_at=sim_record.created_at,
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
        self, customer_id: str, engine_slug: str | None, strategy_engine_slug: str | None = None
    ) -> PredictionEngine:
        if engine_slug is not None:
            return PredictionEngine(engine_slug)
        return await self._prediction_service._resolve_engine(customer_id, None, strategy_engine_slug)
