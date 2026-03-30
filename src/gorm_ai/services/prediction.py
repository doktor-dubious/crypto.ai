"""Prediction service for managing predictions."""

import heapq
import logging
import math
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[int, str | None], Awaitable[None]]

from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.covariate import Covariate, CovariateOutlet
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.prediction_engine import PredictionEngine as PredictionEngineModel
from gorm_ai.database.models.prediction_engine_parameter import PredictionEngineParameter
from gorm_ai.database.models.financial_date import FinancialDate, OutletFinancialDate
from gorm_ai.database.models.last_prediction import LastPrediction
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_delivery import OutletDelivery
from gorm_ai.database.models.outlet_financials import OutletFinancials
from gorm_ai.database.models.outlet_group import OutletGroupMember
from gorm_ai.database.models.pad import Pad, PadDate
from gorm_ai.database.models.prediction import Prediction
from gorm_ai.database.models.prediction_adjustment import PredictionAdjustment
from gorm_ai.database.models.prediction_outlet import PredictionOutlet
from gorm_ai.database.models.prediction_strategy import PredictionStrategy
from gorm_ai.database.models.sales import Sales
from gorm_ai.prediction.preprocessor import DataPreprocessor
from gorm_ai.prediction.registry import EngineRegistry
from gorm_ai.schemas.prediction import (
    MarginalValueOutlet,
    MarginalValueRequest,
    MarginalValueResponse,
    OutletPrediction,
    PredictionEngine,
    PredictionRequest,
    PredictionResponse,
    PredictionResult,
)
from gorm_ai.services.sales import SalesService

_CONFIGURATION_SINGLETON_ID = "00000000-0000-0000-0000-000000000001"


class PredictionService:
    """Service for prediction operations."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.sales_service = SalesService(session)
        self.engine_registry = EngineRegistry()

    async def create_prediction(
        self,
        request: PredictionRequest,
        on_progress: ProgressCallback | None = None,
        task_id: str | None = None,
    ) -> PredictionResponse:
        """Create a prediction based on historical sales data."""
        # Load strategy and apply its columns as defaults (request params take precedence)
        strategy_engine_slug: str | None = None
        finetuned_model: str | None = None
        finetuned_model_base_path: str | None = None
        if request.prediction_strategy_id:
            strategy = await self._load_strategy(request.prediction_strategy_id)
            if strategy:
                defaults = self._strategy_defaults(strategy)
                updates = {k: v for k, v in defaults.items() if getattr(request, k, None) in (None, False)}
                if updates:
                    request = request.model_copy(update=updates)
                if strategy.prediction_engine:
                    strategy_engine_slug = strategy.prediction_engine.slug
                    finetuned_model_base_path = strategy.prediction_engine.finetuned_model_path
                finetuned_model = strategy.finetuned_model

        # Resolve which engine to use (request → strategy → customer config → global config → default)
        engine_type = await self._resolve_engine(request.customer_id, request.engine, strategy_engine_slug)

        # Horizon = number of days in the prediction window (inclusive)
        horizon = (request.prediction_to - request.prediction_from).days + 1
        if horizon < 1:
            raise ValueError("prediction_to must be on or after prediction_from")

        # Resolve fallback_engine setting
        allow_fallback = await self._resolve_fallback_engine(request.customer_id)

        # When a finetuned model is selected, use the finetuned engine variant
        # with the specific checkpoint path
        if finetuned_model and finetuned_model_base_path:
            import os
            checkpoint_path = os.path.join(finetuned_model_base_path, finetuned_model)
            from gorm_ai.prediction.engines.timesfm_finetuned import TimesFMFinetunedEngine
            engine = TimesFMFinetunedEngine(
                checkpoint_path=checkpoint_path,
                allow_fallback=allow_fallback,
            )
            logger.info("Using finetuned model: %s", checkpoint_path)
        else:
            engine = self.engine_registry.get_engine(engine_type)
        engine.allow_fallback = allow_fallback
        resolved_engine_params = await self._apply_engine_parameters(
            engine, engine_type.value, request.prediction_strategy_id,
        )
        capabilities = engine.get_capabilities()

        # Resolve outlet IDs: explicit list → request group → customer config group → all active
        outlet_ids = request.outlet_ids
        if not outlet_ids:
            group_id = request.outlet_group_id
            if not group_id:
                cc_result = await self.session.execute(
                    select(CustomerConfiguration).where(
                        CustomerConfiguration.customer_id == request.customer_id,
                        CustomerConfiguration.active.is_(True),
                    )
                )
                cc = cc_result.scalar_one_or_none()
                group_id = cc.group_id if cc else None
            outlet_ids = await self._resolve_marginal_outlets(request.customer_id, None, group_id)

        # Fetch all historical data up to the cutoff (delay days before the prediction window)
        history_end = request.prediction_from - timedelta(days=1 + request.delay)

        # Pad event dates are customer-level (same for all outlets; effect learned per outlet by Ridge)
        pad_covariates = await self._build_pad_covariates(request.customer_id) if request.use_pad else None

        # Fetch all outlet sales in one query, then process per-outlet in memory.
        # Limit to max_history_length days — the engine trims to this anyway, and
        # fetching years of extra history just to discard it in Python is very slow.
        history_days = capabilities.max_history_length or 1024
        history_start = history_end - timedelta(days=history_days - 1)

        if on_progress:
            await on_progress(5, f"Loading data ({len(outlet_ids)} outlets)")

        all_sales = await self.sales_service.get_by_date_range_bulk(
            customer_id=request.customer_id,
            outlet_ids=outlet_ids,
            end_date=history_end,
            start_date=history_start,
            apply_sales_filter=True,
        )

        # Bulk-fetch financials covariates for all outlets in one pass
        if request.use_financials:
            if on_progress:
                await on_progress(15, "Loading financials")
            cov_end = request.prediction_from + timedelta(days=horizon - 1)
            # Use the earliest sales date across all outlets as the covariate start
            cov_start = min(
                (sales[0][0] for sales in all_sales.values() if sales),
                default=request.prediction_from,
            )
            all_covariates = await self._build_covariates_bulk(
                outlet_ids=outlet_ids,
                customer_id=request.customer_id,
                start_date=cov_start,
                end_date=cov_end,
            )
        else:
            all_covariates = {}

        # Resolve weekday correction flags once for all outlets in this prediction run.
        weekday_correction = await self._resolve_weekday_correction(request.customer_id)
        weekday_profile_params = await self._resolve_weekday_profile_correction(request.customer_id)
        variation_params = await self._resolve_variation_adjustment(request.customer_id)
        eo_params = await self._resolve_eo_params(request.customer_id)

        # Filter closed-day data from historical series so that engines don't
        # see artificial zeros on days the customer is closed.
        open_days = await self._resolve_open_days(request.customer_id)
        if not all(open_days):
            all_sales = {
                oid: [(d, v) for d, v in sales if open_days[d.weekday()]]
                for oid, sales in all_sales.items()
            }

        # --- Per-outlet open-day filtering ---
        # An outlet may be closed on certain weekdays even when the customer
        # is open (e.g. an outlet that only operates on Saturdays).  The
        # OutletDelivery.open flag records this per outlet per weekday.
        #
        # If we don't filter here, the engine sees zeros on the outlet's
        # closed days, which drags the forecast down — the same problem that
        # customer-level open_days filtering solves, but at outlet granularity.
        #
        # outlet_closed_days: {outlet_id: set of python weekdays (0-6) that
        #                      are CLOSED for this outlet}
        # Only outlets that have at least one explicitly closed day AND at
        # least one explicitly open day are included — if an outlet has no
        # delivery config at all, we assume all (customer-open) days are open.
        delivery_map_early = await self._load_outlet_deliveries(outlet_ids)
        outlet_closed_days: dict[str, set[int]] = {}
        for oid, wd_map in delivery_map_early.items():
            # OutletDelivery.weekday uses 1-7 (Mon=1, Sun=7).
            # Python date.weekday() uses 0-6 (Mon=0, Sun=6).
            # Convert: python_wd = db_wd - 1
            closed = {wd - 1 for wd, od in wd_map.items() if not od.open}
            has_open = any(od.open for od in wd_map.values())
            # Only filter if the outlet has at least one open day defined
            # (otherwise the open flags may not be configured at all).
            if closed and has_open:
                outlet_closed_days[oid] = closed

        if outlet_closed_days:
            for oid, closed_wds in outlet_closed_days.items():
                if oid in all_sales:
                    all_sales[oid] = [
                        (d, v) for d, v in all_sales[oid]
                        if d.weekday() not in closed_wds
                    ]

        # Collect per-outlet inputs (pure in-memory, no DB calls).
        # Skip outlets with insufficient history — passing empty or near-empty
        # arrays to the model causes NumPy dtype errors.
        min_history = capabilities.min_history_length or 1
        batch_items: list[dict] = []
        valid_outlet_ids: list[str] = []
        covariates_by_outlet: dict[str, dict[str, dict[date, float]] | None] = {}
        for outlet_id in outlet_ids:
            sales_data = all_sales.get(outlet_id, [])
            if len(sales_data) < min_history:
                continue
            historical_data = self._prepare_historical_data(sales_data)

            covariates = all_covariates.get(outlet_id) if request.use_financials else None
            covariates_by_outlet[outlet_id] = covariates
            batch_items.append({
                "historical_data": historical_data,
                "covariates": covariates,
                "pad_dates": pad_covariates,
                "weekday_correction": weekday_correction,
                "weekday_profile_correction": weekday_profile_params,
                "variation_adjustment": variation_params,
                "eo_params": eo_params,
                **(request.engine_params or {}),
            })
            valid_outlet_ids.append(outlet_id)

        if on_progress:
            await on_progress(30, "Running prediction engine")

        all_results = await engine.predict_batch(
            batch_items,
            horizon=horizon,
            prediction_from=request.prediction_from,
            batch_size=request.batch_size,
        )

        # Weekday-only override: for dates whose weekday has weekday_only=True,
        # re-run predict_batch with history filtered to that weekday only.
        weekday_only_flags = await self._resolve_weekday_only(request.customer_id)
        future_dates = DataPreprocessor.generate_future_dates(request.prediction_from, horizon)
        wo_dates = [d for d in future_dates if weekday_only_flags[d.weekday()]]
        if wo_dates:
            outlet_idx = {oid: i for i, oid in enumerate(valid_outlet_ids)}
            date_idx = {d: i for i, d in enumerate(future_dates)}
            for wo_date in wo_dates:
                target_wd = wo_date.weekday()
                wo_items: list[dict] = []
                wo_ids: list[str] = []
                for outlet_id in valid_outlet_ids:
                    filtered = [
                        (d, v) for d, v in all_sales.get(outlet_id, [])
                        if d.weekday() == target_wd
                    ]
                    if len(filtered) < (capabilities.min_history_length or 1):
                        continue
                    wo_items.append({
                        "historical_data": self._prepare_historical_data(filtered),
                        "covariates": covariates_by_outlet.get(outlet_id) if request.use_financials else None,
                        "pad_dates": pad_covariates,
                        "weekday_correction": [False] * 7,
                        "eo_params": eo_params,
                    })
                    wo_ids.append(outlet_id)
                if not wo_items:
                    continue
                wo_results = await engine.predict_batch(
                    wo_items, horizon=1, prediction_from=wo_date, batch_size=request.batch_size
                )
                ri = date_idx[wo_date]
                for wo_oid, wo_res in zip(wo_ids, wo_results):
                    if wo_res:
                        all_results[outlet_idx[wo_oid]][ri] = wo_res[0]

        # Zero out predictions on closed days — the customer is not open.
        if not all(open_days):
            future_dates_od = DataPreprocessor.generate_future_dates(request.prediction_from, horizon)
            for results in all_results:
                for i, d in enumerate(future_dates_od):
                    if not open_days[d.weekday()] and i < len(results):
                        r = results[i]
                        n_q = len(r.quantiles) if r.quantiles else 0
                        results[i] = PredictionResult(
                            date=d,
                            predicted_value=0,
                            lower_bound=0,
                            upper_bound=0,
                            economic_optimal=0,
                            quantiles=[0.0] * n_q if n_q else None,
                        )

        # --- Per-outlet closed-day zeroing ---
        # Same as customer-level zeroing above, but applied per-outlet using
        # the OutletDelivery.open flags.  An outlet that is closed on a
        # given weekday should produce zero predictions for that day,
        # regardless of the customer-level open_days setting.
        if outlet_closed_days:
            future_dates_od2 = DataPreprocessor.generate_future_dates(request.prediction_from, horizon)
            for oid, results in zip(valid_outlet_ids, all_results):
                closed_wds = outlet_closed_days.get(oid)
                if not closed_wds:
                    continue
                for i, d in enumerate(future_dates_od2):
                    if d.weekday() in closed_wds and i < len(results):
                        r = results[i]
                        n_q = len(r.quantiles) if r.quantiles else 0
                        results[i] = PredictionResult(
                            date=d,
                            predicted_value=0,
                            lower_bound=0,
                            upper_bound=0,
                            economic_optimal=0,
                            quantiles=[0.0] * n_q if n_q else None,
                        )

        ridge_results = getattr(engine, "_last_ridge_results", None)
        weekday_corrections: dict[str, dict[int, float]] = {}
        if ridge_results:
            weekday_corrections = self._extract_weekday_corrections(valid_outlet_ids, ridge_results)
            await self._persist_covariate_outlets(
                valid_outlet_ids, ridge_results, task_id=task_id
            )

        if on_progress:
            await on_progress(85, "Saving results")

        outlets: list[OutletPrediction] = [
            OutletPrediction(outlet_id=outlet_id, results=results)
            for outlet_id, results in zip(valid_outlet_ids, all_results)
        ]

        actual_engine = engine.get_actual_slug() or engine_type.value
        if actual_engine != engine_type.value:
            if not allow_fallback:
                raise RuntimeError(
                    f"Engine fallback disabled: requested {engine_type.value} "
                    f"but fell back to {actual_engine}"
                )
            logger.warning(
                "prediction.engine_fallback: requested=%s actual=%s task=%s",
                engine_type.value, actual_engine, task_id,
            )
        rounding = await self._resolve_rounding(request.customer_id)
        default_cost, default_profit = await self._get_default_financials(request.customer_id) if request.total_return_pct is not None else (None, None)
        await self._persist_predictions(
            request, actual_engine, engine_type.value, valid_outlet_ids, all_results, rounding,
            task_id=task_id,
            increase_total_by=request.increase_total_by,
            increase_total_by_pct=request.increase_total_by_pct,
            increase_outlets_by=request.increase_outlets_by,
            increase_outlets_by_pct=request.increase_outlets_by_pct,
            fixed_total_delivery=request.fixed_total_delivery,
            total_return_pct=request.total_return_pct,
            target_return_pct=request.target_return_pct,
            outlet_return_percentage=request.outlet_return_percentage,
            ignore_fixed=request.ignore_fixed,
            ignore_minimum=request.ignore_minimum,
            ignore_maximum=request.ignore_maximum,
            covariates_by_outlet=covariates_by_outlet,
            default_cost=default_cost,
            default_profit=default_profit,
            weekday_corrections=weekday_corrections,
            engine_params=resolved_engine_params or None,
        )

        if on_progress:
            await on_progress(95, "Finalizing")

        return PredictionResponse(
            id=str(uuid4()),
            customer_id=request.customer_id,
            engine=engine_type,
            horizon=horizon,
            outlets=outlets,
            created_at=datetime.now(UTC),
        )

    async def _persist_predictions(
        self,
        request: PredictionRequest,
        engine: str,
        requested_engine: str,
        outlet_ids: list[str],
        all_results: list[list[PredictionResult]],
        rounding: int = 2,
        task_id: str | None = None,
        increase_total_by: int | None = None,
        increase_total_by_pct: float | None = None,
        increase_outlets_by: int | None = None,
        increase_outlets_by_pct: float | None = None,
        fixed_total_delivery: int | None = None,
        total_return_pct: float | None = None,
        target_return_pct: float | None = None,
        outlet_return_percentage: dict[str, float] | None = None,
        ignore_fixed: bool = False,
        ignore_minimum: bool = False,
        ignore_maximum: bool = False,
        covariates_by_outlet: "dict[str, dict[str, dict[date, float]] | None] | None" = None,
        default_cost: float | None = None,
        default_profit: float | None = None,
        weekday_corrections: "dict[str, dict[int, float]] | None" = None,
        engine_params: dict | None = None,
    ) -> None:
        """Persist one Prediction + N PredictionOutlet rows for each date in the window."""
        # Load delivery constraints for all outlets (weekday → OutletDelivery)
        delivery_map = await self._load_outlet_deliveries(outlet_ids)

        # Group results by date: date → {outlet_id: PredictionResult}
        date_outlet: dict[date, dict[str, PredictionResult]] = {}
        for outlet_id, results in zip(outlet_ids, all_results):
            for r in results:
                date_outlet.setdefault(r.date, {})[outlet_id] = r

        # Load actuals for all outlet/date combinations in one query
        # (date, outlet_id) → sold
        pred_dates = list(date_outlet.keys())
        actuals_result = await self.session.execute(
            select(Sales.outlet_id, Sales.date, Sales.sold)
            .where(
                Sales.outlet_id.in_(outlet_ids),
                Sales.date.in_(pred_dates),
                Sales.active.is_(True),
            )
        )
        actuals: dict[tuple[date, str], float] = {
            (row.date, row.outlet_id): float(row.sold)
            for row in actuals_result.all()
            if row.sold is not None
        }

        # Load prediction adjustments for the outlet group (date-specific overrides)
        adj_by_date: dict[date, list[PredictionAdjustment]] = {}
        if request.outlet_group_id:
            adj_result = await self.session.execute(
                select(PredictionAdjustment).where(
                    PredictionAdjustment.group_id == request.outlet_group_id,
                    PredictionAdjustment.date.in_(pred_dates),
                    PredictionAdjustment.active.is_(True),
                )
            )
            for adj in adj_result.scalars():
                adj_by_date.setdefault(adj.date, []).append(adj)

        for pred_date, outlet_results in sorted(date_outlet.items()):
            weekday = pred_date.weekday() + 1  # 1=Monday, 7=Sunday

            prediction = Prediction(
                customer_id=request.customer_id,
                prediction_strategy_id=request.prediction_strategy_id,
                outlet_group_id=request.outlet_group_id,
                outlet_ids=request.outlet_ids,
                date=pred_date,
                delay=request.delay,
                engine=engine,
                requested_engine=requested_engine,
                engine_params=engine_params,
                use_financials=request.use_financials,
                use_pad=request.use_pad,
                batch_size=request.batch_size,
                task_id=task_id,
            )
            self.session.add(prediction)
            await self.session.flush()  # populate prediction.id

            # Compute final delivered quantity for each outlet on this date
            outlet_delivered: dict[str, int] = {}
            outlet_applied: dict[str, dict[str, float | None]] = {}
            if fixed_total_delivery is not None:
                outlets_data = [
                    (oid, r.predicted_value, r.lower_bound, r.upper_bound)
                    for oid, r in outlet_results.items()
                ]
                outlet_deliveries = {oid: delivery_map.get(oid, {}).get(weekday) for oid in outlet_results}
                outlet_delivered = self._distribute_fixed_total(
                    outlets_data, outlet_deliveries, fixed_total_delivery,
                    ignore_fixed=ignore_fixed, ignore_minimum=ignore_minimum, ignore_maximum=ignore_maximum,
                )
                for oid in outlet_results:
                    outlet_applied[oid] = self._infer_applied_constraints(
                        outlet_delivered[oid], outlet_deliveries.get(oid),
                        ignore_fixed=ignore_fixed, ignore_minimum=ignore_minimum, ignore_maximum=ignore_maximum,
                    )
            elif total_return_pct is not None:
                def _fin(oid: str, key: str) -> float | None:
                    cov = (covariates_by_outlet or {}).get(oid)
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
                outlet_delivered = self._distribute_for_total_return_pct(
                    outlets_data_fin, outlet_deliveries, total_return_pct,
                    default_cost=default_cost, default_profit=default_profit,
                    ignore_fixed=ignore_fixed, ignore_minimum=ignore_minimum, ignore_maximum=ignore_maximum,
                )
                for oid in outlet_results:
                    outlet_applied[oid] = self._infer_applied_constraints(
                        outlet_delivered[oid], outlet_deliveries.get(oid),
                        ignore_fixed=ignore_fixed, ignore_minimum=ignore_minimum, ignore_maximum=ignore_maximum,
                    )
            else:
                # Normal flow: base from _compute_delivered, then distribute any extras
                # Accumulate prediction adjustments for this date
                adj_outlet_num = 0.0
                adj_outlet_pct = 0.0
                adj_total_num = 0
                adj_total_pct = 0.0
                for adj in adj_by_date.get(pred_date, []):
                    if adj.type == 1:    # PER_OUTLET_BY_NUMBER
                        adj_outlet_num += adj.value
                    elif adj.type == 2:  # PER_OUTLET_BY_PERCENTAGE
                        adj_outlet_pct += adj.value
                    elif adj.type == 3:  # OVERALL_BY_NUMBER
                        adj_total_num += int(adj.value)
                    elif adj.type == 4:  # OVERALL_BY_PERCENTAGE
                        adj_total_pct += adj.value

                eff_outlet_num = float(increase_outlets_by or 0) + adj_outlet_num
                eff_outlet_pct = float(increase_outlets_by_pct or 0) + adj_outlet_pct

                for outlet_id, r in outlet_results.items():
                    delivery = delivery_map.get(outlet_id, {}).get(weekday)
                    effective_return_pct = (
                        (outlet_return_percentage or {}).get(outlet_id)
                        if outlet_return_percentage
                        else None
                    ) or target_return_pct
                    if effective_return_pct is not None:
                        base = self._delivered_for_return_pct(
                            effective_return_pct, r.predicted_value, r.lower_bound, r.upper_bound
                        )
                        qty, applied = self._compute_delivered(
                            None, base, delivery, rounding,
                            outlet_increase_num=eff_outlet_num,
                            outlet_increase_pct=eff_outlet_pct,
                            ignore_fixed=ignore_fixed, ignore_minimum=ignore_minimum, ignore_maximum=ignore_maximum,
                        )
                    else:
                        qty, applied = self._compute_delivered(
                            r.economic_optimal, r.predicted_value, delivery, rounding,
                            outlet_increase_num=eff_outlet_num,
                            outlet_increase_pct=eff_outlet_pct,
                            ignore_fixed=ignore_fixed, ignore_minimum=ignore_minimum, ignore_maximum=ignore_maximum,
                        )
                    outlet_delivered[outlet_id] = qty
                    outlet_applied[outlet_id] = applied
                n_extra = (increase_total_by or 0) + adj_total_num
                eff_total_pct = (increase_total_by_pct or 0) + adj_total_pct
                if eff_total_pct:
                    n_extra += round(sum(outlet_delivered.values()) * eff_total_pct / 100)
                if n_extra > 0:
                    outlets_data = [
                        (oid, r.predicted_value, r.lower_bound, r.upper_bound, float(outlet_delivered[oid]))
                        for oid, r in outlet_results.items()
                    ]
                    extras = self._distribute_extra_copies(outlets_data, n_extra)
                    for oid, extra in extras.items():
                        outlet_delivered[oid] += extra

            for outlet_id, r in outlet_results.items():
                ap = outlet_applied.get(outlet_id, {})
                oc = (weekday_corrections or {}).get(outlet_id, {})
                q = r.quantiles  # [P10..P90] or None
                self.session.add(PredictionOutlet(
                    prediction_id=prediction.id,
                    outlet_id=outlet_id,
                    predicted=r.predicted_value,
                    lower_bound=r.lower_bound,
                    upper_bound=r.upper_bound,
                    confidence=r.confidence,
                    eo=r.economic_optimal,
                    cv=r.cv,
                    delivered=outlet_delivered[outlet_id],
                    actual_sale=actuals.get((pred_date, outlet_id)),
                    q20=q[1] if q else None,
                    q30=q[2] if q else None,
                    q40=q[3] if q else None,
                    q50=q[4] if q else None,
                    q60=q[5] if q else None,
                    q70=q[6] if q else None,
                    q80=q[7] if q else None,
                    fixed=ap.get("fixed"),
                    minimum=ap.get("minimum"),
                    maximum=ap.get("maximum"),
                    add=ap.get("add"),
                    add_pct=ap.get("add_pct"),
                    correction_mon=oc.get(1),
                    correction_tue=oc.get(2),
                    correction_wed=oc.get(3),
                    correction_thu=oc.get(4),
                    correction_fri=oc.get(5),
                    correction_sat=oc.get(6),
                    correction_sun=oc.get(7),
                ))

            # Upsert last_prediction — one row per (outlet_id, weekday), always current
            # Flush pending ORM objects first so the SELECT below sees the latest state.
            await self.session.flush()
            for outlet_id, r in outlet_results.items():
                ap = outlet_applied.get(outlet_id, {})
                oc = (weekday_corrections or {}).get(outlet_id, {})

                existing = await self.session.execute(
                    select(LastPrediction).where(
                        LastPrediction.outlet_id == outlet_id,
                        LastPrediction.weekday == weekday,
                    )
                )
                lp = existing.scalar_one_or_none()
                if lp is None:
                    lp = LastPrediction(outlet_id=outlet_id, weekday=weekday)
                    self.session.add(lp)

                lp.prediction_id = prediction.id
                lp.predicted = r.predicted_value
                lp.economic_optimal = r.economic_optimal
                lp.cv = r.cv
                lp.delivered = float(outlet_delivered[outlet_id])
                lp.lower_bound = r.lower_bound
                lp.upper_bound = r.upper_bound
                lp.fixed = ap.get("fixed")
                lp.minimum = ap.get("minimum")
                lp.maximum = ap.get("maximum")
                lp.add = ap.get("add")
                lp.add_pct = ap.get("add_pct")
                lp.weekday_correction = oc.get(weekday)

    async def _load_outlet_deliveries(
        self, outlet_ids: list[str]
    ) -> dict[str, dict[int, OutletDelivery]]:
        """Load active delivery configs keyed by outlet_id → weekday (1-7)."""
        result = await self.session.execute(
            select(OutletDelivery).where(
                OutletDelivery.outlet_id.in_(outlet_ids),
                OutletDelivery.active.is_(True),
            )
        )
        mapping: dict[str, dict[int, OutletDelivery]] = {}
        for row in result.scalars():
            mapping.setdefault(row.outlet_id, {})[row.weekday] = row
        return mapping

    def _compute_delivered(
        self,
        eo: float | None,
        predicted: float,
        delivery: "OutletDelivery | None",
        rounding: int = 2,
        outlet_increase_num: float = 0.0,
        outlet_increase_pct: float = 0.0,
        ignore_fixed: bool = False,
        ignore_minimum: bool = False,
        ignore_maximum: bool = False,
    ) -> "tuple[int, dict[str, float | None]]":
        """Apply outlet delivery constraints to arrive at the final delivered quantity.

        Returns (delivered_qty, applied_constraints) where applied_constraints only
        contains non-None values for constraints that were actually binding.

        Uses eo (economic optimal) as the base when available, falling back to
        predicted_value when eo is None (no financial data configured).

        Per-outlet increases (outlet_increase_num / outlet_increase_pct) are applied
        to the base BEFORE delivery constraints. Precedence of constraints (highest first):
          1. fixed    — overrides everything
          2. minimum  — clamp up
             maximum  — clamp down
          3. add      — add fixed amount
             add_pct  — multiply by (1 + pct/100); applied after add

        rounding: 1=round, 2=ceil (default), 3=floor
        """
        import math

        def _round(v: float) -> int:
            if math.isnan(v):
                return 1
            if rounding == 2:
                return max(1, math.ceil(v))
            if rounding == 3:
                return max(1, math.floor(v))
            return max(1, round(v))

        applied: dict[str, float | None] = {
            "fixed": None, "minimum": None, "maximum": None, "add": None, "add_pct": None,
        }
        base = eo if eo is not None else predicted

        # Per-outlet increases applied before delivery constraints
        if outlet_increase_num:
            base += outlet_increase_num
        if outlet_increase_pct:
            base += base * outlet_increase_pct / 100.0

        if delivery is None:
            return _round(base), applied

        # 1. Fixed override (0 means not set)
        if not ignore_fixed and delivery.fixed:
            applied["fixed"] = float(delivery.fixed)
            if delivery.add is not None:
                applied["add"] = float(delivery.add)
            if delivery.add_pct is not None:
                applied["add_pct"] = float(delivery.add_pct)
            return _round(delivery.fixed), applied

        delivered = base

        # 2. Min / max clamp
        if not ignore_minimum and delivery.minimum and delivered < delivery.minimum:
            delivered = delivery.minimum
            applied["minimum"] = float(delivery.minimum)
        if not ignore_maximum and delivery.maximum and delivered > delivery.maximum:
            delivered = delivery.maximum
            applied["maximum"] = float(delivery.maximum)

        # 3. Add then add_pct
        if delivery.add is not None:
            delivered += delivery.add
            applied["add"] = float(delivery.add)
        if delivery.add_pct is not None:
            delivered *= 1.0 + delivery.add_pct / 100.0
            applied["add_pct"] = float(delivery.add_pct)

        return _round(delivered), applied

    @staticmethod
    def _infer_applied_constraints(
        delivered_qty: int,
        delivery: "OutletDelivery | None",
        ignore_fixed: bool = False,
        ignore_minimum: bool = False,
        ignore_maximum: bool = False,
    ) -> "dict[str, float | None]":
        """Post-hoc infer which delivery constraints were binding given the final quantity.

        Used for distribution paths (_distribute_fixed_total, _distribute_for_total_return_pct)
        that don't go through _compute_delivered.
        """
        applied: dict[str, float | None] = {
            "fixed": None, "minimum": None, "maximum": None, "add": None, "add_pct": None,
        }
        if delivery is None:
            return applied
        if not ignore_fixed and delivery.fixed:
            applied["fixed"] = float(delivery.fixed)
            return applied
        if not ignore_minimum and delivery.minimum and delivered_qty <= round(delivery.minimum):
            applied["minimum"] = float(delivery.minimum)
        if not ignore_maximum and delivery.maximum and delivered_qty >= round(delivery.maximum):
            applied["maximum"] = float(delivery.maximum)
        return applied

    async def get_marginal_value(self, request: MarginalValueRequest) -> MarginalValueResponse:
        """Rank outlets by P(demand > delivered) — the probability of selling one more copy.

        Looks up the most recent prediction_outlet row per outlet for the given date.
        Probability is estimated by piecewise linear interpolation over the quantile
        forecasts (P10=lower_bound, P50=predicted, P90=upper_bound).
        """
        outlet_ids = await self._resolve_marginal_outlets(
            request.customer_id, request.outlet_ids, request.outlet_group_id
        )

        # Find the most recent prediction_outlet per outlet for this date
        latest_subq = (
            select(
                PredictionOutlet.outlet_id,
                func.max(Prediction.created_at).label("latest"),
            )
            .join(Prediction, PredictionOutlet.prediction_id == Prediction.id)
            .where(
                Prediction.customer_id == request.customer_id,
                Prediction.date == request.date,
                PredictionOutlet.outlet_id.in_(outlet_ids),
                PredictionOutlet.active.is_(True),
            )
            .group_by(PredictionOutlet.outlet_id)
            .subquery()
        )

        rows_result = await self.session.execute(
            select(PredictionOutlet)
            .join(Prediction, PredictionOutlet.prediction_id == Prediction.id)
            .join(
                latest_subq,
                and_(
                    PredictionOutlet.outlet_id == latest_subq.c.outlet_id,
                    Prediction.created_at == latest_subq.c.latest,
                ),
            )
            .where(
                Prediction.customer_id == request.customer_id,
                Prediction.date == request.date,
            )
        )
        rows = rows_result.scalars().all()

        found_ids = {r.outlet_id for r in rows}
        missing = [oid for oid in outlet_ids if oid not in found_ids]

        results: list[MarginalValueOutlet] = []
        for row in rows:
            prob = self._marginal_sale_probability(
                delivered=row.delivered if row.delivered is not None else (row.predicted or 0.0),
                p50=row.predicted or 0.0,
                p10=row.lower_bound,
                p90=row.upper_bound,
            )
            results.append(MarginalValueOutlet(
                outlet_id=row.outlet_id,
                predicted=row.predicted or 0.0,
                lower_bound=row.lower_bound,
                upper_bound=row.upper_bound,
                eo=row.eo,
                delivered=row.delivered,
                marginal_sale_probability=prob,
            ))

        results.sort(key=lambda r: r.marginal_sale_probability, reverse=True)
        return MarginalValueResponse(date=request.date, outlets=results, missing_outlets=missing)

    @staticmethod
    def _marginal_sale_probability(
        delivered: float,
        p50: float,
        p10: float | None,
        p90: float | None,
    ) -> float:
        """P(demand > delivered) via piecewise linear CDF interpolation from quantile forecasts.

        Uses (0, 0%), P10, P50, P90 as CDF anchor points.
        Falls back to a sigmoid centred on P50 when quantiles are unavailable.
        """
        if p10 is not None and p90 is not None:
            # CDF anchors: (demand_value, cumulative_probability)
            anchors = [(0.0, 0.0), (p10, 0.10), (p50, 0.50), (p90, 0.90)]
            for i in range(len(anchors) - 1):
                x0, c0 = anchors[i]
                x1, c1 = anchors[i + 1]
                if delivered <= x1:
                    t = (delivered - x0) / (x1 - x0) if x1 != x0 else 0.5
                    cdf = c0 + t * (c1 - c0)
                    return round(max(0.0, 1.0 - cdf), 4)
            # Beyond P90: extrapolate using the P50→P90 slope
            x0, c0 = anchors[-2]
            x1, c1 = anchors[-1]
            slope = (c1 - c0) / (x1 - x0) if x1 > x0 else 0.0
            cdf = min(0.999, c1 + slope * (delivered - x1))
            return round(max(0.001, 1.0 - cdf), 4)

        # Fallback: sigmoid centred at P50 (no quantiles available)
        if p50 <= 0:
            return 0.5
        ratio = delivered / p50
        return round(1.0 / (1.0 + math.exp(5.0 * (ratio - 1.0))), 4)

    @staticmethod
    def _delivered_for_return_pct(
        target_return_pct: float,
        p50: float,
        p10: float | None,
        p90: float | None,
    ) -> float:
        """Find the delivered quantity such that P(demand < delivered) ≈ target_return_pct / 100.

        Inverts the same piecewise linear CDF used in _marginal_sale_probability.
        A 15% target return means delivering at the 85th percentile of demand.
        Falls back to inverting the sigmoid when quantiles are unavailable.
        """
        target_cdf = max(0.0, min(1.0, target_return_pct / 100.0))

        if p10 is not None and p90 is not None:
            anchors = [(0.0, 0.0), (p10, 0.10), (p50, 0.50), (p90, 0.90)]
            for i in range(len(anchors) - 1):
                x0, c0 = anchors[i]
                x1, c1 = anchors[i + 1]
                if c0 <= target_cdf <= c1:
                    t = (target_cdf - c0) / (c1 - c0) if c1 != c0 else 0.5
                    return max(0.0, x0 + t * (x1 - x0))
            # Beyond P90: extrapolate using the P50→P90 slope
            x0, c0 = anchors[-2]
            x1, c1 = anchors[-1]
            slope = (x1 - x0) / (c1 - c0) if c1 > c0 else 0.0
            return max(0.0, x1 + slope * (target_cdf - c1))

        # Fallback: invert sigmoid centred at P50
        # P(demand > k) = 1 / (1 + exp(5*(k/p50 - 1)))  →  k = p50 * (1 + log(cdf/(1-cdf)) / 5)
        if p50 <= 0:
            return 0.0
        cdf = max(0.001, min(0.999, target_cdf))
        return max(0.0, p50 * (1.0 + math.log(cdf / (1.0 - cdf)) / 5.0))

    @staticmethod
    def _distribute_for_total_return_pct(
        outlets_data: list[tuple[str, float, float | None, float | None, float | None, float | None]],
        outlet_deliveries: dict[str, "OutletDelivery | None"],
        target_return_pct: float,
        default_cost: float | None = None,
        default_profit: float | None = None,
        ignore_fixed: bool = False,
        ignore_minimum: bool = False,
        ignore_maximum: bool = False,
        n_iter: int = 50,
    ) -> dict[str, int]:
        """Distribute copies to hit target_return_pct overall while maximising expected profit.

        Uses a Lagrange multiplier (λ) on the return constraint.  For a given λ each
        outlet's individual target return rate becomes:

            r_i(λ) = (cost_i + λ) / (profit_i + cost_i + λ)

        Binary-searching on λ until the delivery-weighted average of actual per-outlet
        return rates equals the target.  Outlets with higher profit/cost ratios receive
        lower individual return % (higher service level); less profitable outlets absorb
        more returns.  Falls back to uniform behaviour when financials are unavailable
        (treated as cost=0, profit=1).
        """
        target = max(0.001, min(0.999, target_return_pct / 100.0))

        p50m = {oid: p50 for oid, p50, _, _, _, _ in outlets_data}
        p10m = {oid: p10 for oid, _, p10, _, _, _ in outlets_data}
        p90m = {oid: p90 for oid, _, _, p90, _, _ in outlets_data}

        # Resolve financials — fall back to defaults, then to neutral (cost=0, profit=1)
        cost_m: dict[str, float] = {}
        profit_m: dict[str, float] = {}
        for oid, _, _, _, cost, profit in outlets_data:
            cost_m[oid] = float(cost) if cost is not None and cost >= 0 else (float(default_cost) if default_cost is not None else 0.0)
            profit_m[oid] = float(profit) if profit is not None and profit > 0 else (float(default_profit) if default_profit is not None and default_profit > 0 else 1.0)

        def _allocation(lam: float) -> dict[str, int]:
            result: dict[str, int] = {}
            for oid, _, _, _, _, _ in outlets_data:
                delivery = outlet_deliveries.get(oid)
                if not ignore_fixed and delivery and delivery.fixed:
                    result[oid] = max(1, round(delivery.fixed))
                    continue
                denom = profit_m[oid] + cost_m[oid] + lam
                r_i = max(0.001, min(0.999, (cost_m[oid] + lam) / denom)) if denom > 0 else (0.001 if lam < 0 else 0.999)
                d = PredictionService._delivered_for_return_pct(r_i * 100.0, p50m[oid], p10m[oid], p90m[oid])
                d = max(0.0, d)
                if not ignore_minimum and delivery and delivery.minimum:
                    d = max(d, float(delivery.minimum))
                if not ignore_maximum and delivery and delivery.maximum:
                    d = min(d, float(delivery.maximum))
                result[oid] = max(1, round(d))
            return result

        def _actual_return(alloc: dict[str, int]) -> float:
            total_del = sum(alloc.values())
            if total_del == 0:
                return 0.0
            expected_ret = sum(
                d * (1.0 - PredictionService._marginal_sale_probability(float(d), p50m[oid], p10m[oid], p90m[oid]))
                for oid, d in alloc.items()
            )
            return expected_ret / total_del

        # Establish search bounds: lam_low → low return %, lam_high → high return %
        lam_low = -(min(cost_m.values()) + 1.0)
        lam_high = max(profit_m.values()) * 100.0

        if _actual_return(_allocation(lam_low)) >= target:
            return _allocation(lam_low)
        if _actual_return(_allocation(lam_high)) <= target:
            return _allocation(lam_high)

        for _ in range(n_iter):
            lam_mid = (lam_low + lam_high) / 2.0
            if _actual_return(_allocation(lam_mid)) < target:
                lam_low = lam_mid
            else:
                lam_high = lam_mid

        return _allocation((lam_low + lam_high) / 2.0)

    @staticmethod
    def _distribute_fixed_total(
        outlets_data: list[tuple[str, float, float | None, float | None]],
        outlet_deliveries: dict[str, "OutletDelivery | None"],
        total: int,
        ignore_fixed: bool = False,
        ignore_minimum: bool = False,
        ignore_maximum: bool = False,
    ) -> dict[str, int]:
        """Distribute exactly `total` copies respecting fixed/minimum/maximum constraints.

        1. Fixed outlets get their fixed amount; they do not participate in heap distribution.
        2. Free outlets start at their minimum (or 0) and receive additional copies via greedy
           heap until they hit their maximum or the budget is exhausted.
        3. If fixed + minimums already exceed `total`, return those amounts anyway.
        4. If all free outlets hit their maximum before the budget is spent, stop early.
        """
        delivered: dict[str, int] = {}
        p50m = {oid: p50 for oid, p50, _, _ in outlets_data}
        p10m = {oid: p10 for oid, _, p10, _ in outlets_data}
        p90m = {oid: p90 for oid, _, _, p90 in outlets_data}

        committed = 0
        heap: list[tuple[float, str]] = []

        for oid, p50, p10, p90 in outlets_data:
            delivery = outlet_deliveries.get(oid)
            if not ignore_fixed and delivery and delivery.fixed:
                # Fixed outlets: committed at exactly the fixed amount, excluded from heap
                qty = max(1, round(delivery.fixed))
                delivered[oid] = qty
                committed += qty
            else:
                # Free outlets: start at minimum (or 0), participate in heap
                minimum = round(delivery.minimum) if not ignore_minimum and delivery and delivery.minimum else 0
                minimum = max(0, minimum)
                delivered[oid] = minimum
                committed += minimum
                prob = PredictionService._marginal_sale_probability(float(minimum), p50, p10, p90)
                heapq.heappush(heap, (-prob, oid))

        remaining = total - committed
        if remaining <= 0:
            # Condition 1: fixed + minimums already meet or exceed the budget
            return delivered

        while remaining > 0:
            if not heap:
                # Condition 3: all free outlets have hit their maximum or have zero demand
                break

            neg_prob, oid = heapq.heappop(heap)
            if -neg_prob <= 0.0:
                # No remaining demand in any outlet
                break

            delivery = outlet_deliveries.get(oid)
            maximum = round(delivery.maximum) if not ignore_maximum and delivery and delivery.maximum else None

            if maximum is not None and delivered[oid] >= maximum:
                # Already at maximum (stale heap entry); discard and try next
                continue

            delivered[oid] += 1
            remaining -= 1

            # Re-push only if not yet at maximum
            if maximum is None or delivered[oid] < maximum:
                new_prob = PredictionService._marginal_sale_probability(
                    float(delivered[oid]), p50m[oid], p10m[oid], p90m[oid]
                )
                if new_prob > 0.0:
                    heapq.heappush(heap, (-new_prob, oid))

        return delivered

    @staticmethod
    def _distribute_extra_copies(
        outlets_data: list[tuple[str, float, float | None, float | None, float]],
        n_extra: int,
    ) -> dict[str, int]:
        """Greedily assign n_extra copies to outlets with highest P(demand > delivered).

        outlets_data: list of (outlet_id, p50, p10, p90, base_delivered)
        Returns: dict[outlet_id → extra copies added above base]
        """
        delivered = {oid: base for oid, _, _, _, base in outlets_data}
        p50m = {oid: p50 for oid, p50, _, _, _ in outlets_data}
        p10m = {oid: p10 for oid, _, p10, _, _ in outlets_data}
        p90m = {oid: p90 for oid, _, _, p90, _ in outlets_data}
        extras: dict[str, int] = {oid: 0 for oid in delivered}

        heap: list[tuple[float, str]] = []
        for oid, p50, p10, p90, base in outlets_data:
            prob = PredictionService._marginal_sale_probability(base, p50, p10, p90)
            heapq.heappush(heap, (-prob, oid))

        for _ in range(n_extra):
            if not heap:
                break
            neg_prob, oid = heapq.heappop(heap)
            if -neg_prob <= 0.0:
                break
            extras[oid] += 1
            delivered[oid] += 1
            new_prob = PredictionService._marginal_sale_probability(
                delivered[oid], p50m[oid], p10m[oid], p90m[oid]
            )
            heapq.heappush(heap, (-new_prob, oid))

        return extras

    async def _resolve_marginal_outlets(
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
        return await self._get_active_outlet_ids(customer_id)

    async def _get_default_financials(self, customer_id: str) -> tuple[float | None, float | None]:
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

    async def _resolve_weekday_correction(self, customer_id: str) -> list[bool]:
        """Resolve weekday correction flags [Mon..Sun]: customer_configuration → configuration → all True."""
        _DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()

        result = await self.session.execute(
            select(Configuration).where(Configuration.id == _CONFIGURATION_SINGLETON_ID)
        )
        gc = result.scalar_one_or_none()

        flags = []
        for day in _DAYS:
            col = f"weekday_correction_{day}"
            cc_val = getattr(cc, col, None) if cc else None
            if cc_val is not None:
                flags.append(cc_val)
            elif gc is not None:
                flags.append(getattr(gc, col, True))
            else:
                flags.append(True)
        return flags

    async def _resolve_weekday_only(self, customer_id: str) -> list[bool]:
        """Resolve weekday_only flags [Mon..Sun]: customer_configuration → configuration → False."""
        _DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()

        result = await self.session.execute(
            select(Configuration).where(Configuration.id == _CONFIGURATION_SINGLETON_ID)
        )
        gc = result.scalar_one_or_none()

        flags = []
        for day in _DAYS:
            col = f"weekday_only_{day}"
            cc_val = getattr(cc, col, None) if cc else None
            if cc_val is not None:
                flags.append(cc_val)
            elif gc is not None:
                flags.append(getattr(gc, col, False))
            else:
                flags.append(False)
        return flags

    async def _resolve_open_days(self, customer_id: str) -> list[bool]:
        """Resolve open_* flags [Mon..Sun]: customer_configuration → configuration → True."""
        _DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()

        result = await self.session.execute(
            select(Configuration).where(Configuration.id == _CONFIGURATION_SINGLETON_ID)
        )
        gc = result.scalar_one_or_none()

        flags = []
        for day in _DAYS:
            col = f"open_{day}"
            cc_val = getattr(cc, col, None) if cc else None
            if cc_val is not None:
                flags.append(cc_val)
            elif gc is not None:
                flags.append(getattr(gc, col, True))
            else:
                flags.append(True)
        return flags

    async def _resolve_weekday_profile_correction(self, customer_id: str) -> dict:
        """Resolve weekday profile correction params: customer_configuration → configuration → defaults.

        Returns dict with keys: enabled (bool), strength (float), threshold (float).
        """
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()

        result = await self.session.execute(
            select(Configuration).where(Configuration.id == _CONFIGURATION_SINGLETON_ID)
        )
        gc = result.scalar_one_or_none()

        def _resolve(attr: str, default):
            cc_val = getattr(cc, attr, None) if cc else None
            if cc_val is not None:
                return cc_val
            if gc is not None:
                return getattr(gc, attr, default)
            return default

        return {
            "enabled": _resolve("weekday_profile_correction", False),
            "strength": _resolve("weekday_profile_correction_strength", 1.0),
            "threshold": _resolve("weekday_profile_correction_threshold", 0.0),
            "method": _resolve("weekday_profile_correction_method", 1),
        }

    async def _resolve_variation_adjustment(
        self, customer_id: str,
    ) -> dict:
        """Resolve variation adjustment params.

        Returns dict with keys: enabled (bool), history_days (int).
        """
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()

        result = await self.session.execute(
            select(Configuration).where(
                Configuration.id == _CONFIGURATION_SINGLETON_ID,
            )
        )
        gc = result.scalar_one_or_none()

        def _resolve(attr: str, default):
            cc_val = getattr(cc, attr, None) if cc else None
            if cc_val is not None:
                return cc_val
            if gc is not None:
                return getattr(gc, attr, default)
            return default

        return {
            "enabled": _resolve("variation_adjustment", False),
            "history_days": _resolve("variation_history_days", 365),
        }

    async def _resolve_eo_params(self, customer_id: str) -> dict:
        """Resolve EO methodology and extrapolation settings.

        Returns dict with keys: methodology (int), extrapolation (bool).
        """
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()

        result = await self.session.execute(
            select(Configuration).where(
                Configuration.id == _CONFIGURATION_SINGLETON_ID,
            )
        )
        gc = result.scalar_one_or_none()

        def _resolve(attr: str, default):
            cc_val = getattr(cc, attr, None) if cc else None
            if cc_val is not None:
                return cc_val
            if gc is not None:
                return getattr(gc, attr, default)
            return default

        return {
            "methodology": _resolve("eo_methodology", 1),
            "extrapolation": _resolve("eo_extrapolation", 1),
        }

    async def _resolve_fallback_engine(self, customer_id: str) -> bool:
        """Resolve fallback_engine: customer_configuration → configuration → False."""
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()
        if cc and cc.fallback_engine is not None:
            return cc.fallback_engine

        result = await self.session.execute(
            select(Configuration).where(
                Configuration.id == _CONFIGURATION_SINGLETON_ID,
            )
        )
        gc = result.scalar_one_or_none()
        if gc is not None:
            return gc.fallback_engine
        return False

    async def _resolve_rounding(self, customer_id: str) -> int:
        """Resolve eo_to_delivery_rounding: customer_configuration → configuration → default (ceil)."""
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()
        if cc and cc.eo_to_delivery_rounding is not None:
            return cc.eo_to_delivery_rounding

        result = await self.session.execute(
            select(Configuration).where(Configuration.id == _CONFIGURATION_SINGLETON_ID)
        )
        gc = result.scalar_one_or_none()
        if gc and gc.eo_to_delivery_rounding is not None:
            return gc.eo_to_delivery_rounding

        return 2  # default: ceil

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
             matches customer_id + exact date
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
                FinancialDate.date >= start_date,
                FinancialDate.date <= end_date,
            )
        )
        result = await self.session.execute(stmt)
        fd_rows = result.all()  # list of (FinancialDate, OutletFinancialDate | None)

        # Build a fast lookup: date → (FinancialDate, OutletFinancialDate | None)
        fd_by_date: dict[date, tuple] = {}
        for fd, ofd in fd_rows:
            fd_by_date[fd.date] = (fd, ofd)

        # Resolve cost and profit for every date in the range
        cost_map: dict[date, float] = {}
        profit_map: dict[date, float] = {}
        current = start_date
        while current <= end_date:
            weekday = current.weekday() + 1  # 1=Mon, 7=Sun

            # Level A: find a matching FinancialDate with an outlet-specific override
            override_cost: float | None = None
            override_profit: float | None = None
            fd_entry = fd_by_date.get(current)
            if fd_entry is not None:
                _, ofd = fd_entry
                if ofd is not None:
                    if ofd.cost_per_unit is not None:
                        override_cost = ofd.cost_per_unit
                    if ofd.profit_per_unit is not None:
                        override_profit = ofd.profit_per_unit

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

    async def _build_covariates_bulk(
        self,
        outlet_ids: list[str],
        customer_id: str,
        start_date: date,
        end_date: date,
    ) -> dict[str, dict[str, dict[date, float]] | None]:
        """Build covariates for all outlets in 4-5 queries instead of 4×N.

        Returns dict mapping outlet_id → covariates (same shape as _build_covariates).
        """
        # Level B: all OutletFinancials for these outlets in one query
        result = await self.session.execute(
            select(OutletFinancials).where(
                OutletFinancials.outlet_id.in_(outlet_ids),
                OutletFinancials.active.is_(True),
            )
        )
        outlet_weekday_cost: dict[str, dict[int, float]] = {}
        outlet_weekday_profit: dict[str, dict[int, float]] = {}
        for row in result.scalars():
            oid = row.outlet_id
            if row.cost_per_unit is not None:
                outlet_weekday_cost.setdefault(oid, {})[row.weekday] = row.cost_per_unit
            if row.profit_per_unit is not None:
                outlet_weekday_profit.setdefault(oid, {})[row.weekday] = row.profit_per_unit

        # Level C: CustomerConfiguration (one row, shared across all outlets)
        result = await self.session.execute(
            select(CustomerConfiguration).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        cc = result.scalar_one_or_none()
        default_cost: float | None = cc.cost_per_unit if cc else None
        default_profit: float | None = cc.profit_per_unit if cc else None

        # Level D: global Configuration (only if still missing)
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

        # Level A: fetch all FinancialDate rows for this customer+range once
        result = await self.session.execute(
            select(FinancialDate).where(
                FinancialDate.customer_id == customer_id,
                FinancialDate.active.is_(True),
                FinancialDate.date >= start_date,
                FinancialDate.date <= end_date,
            )
        )
        fd_rows = result.scalars().all()
        fd_ids = [fd.id for fd in fd_rows]

        # Fetch all outlet-specific overrides for these FinancialDate rows in one query
        ofd_by_outlet: dict[str, list[OutletFinancialDate]] = {}
        if fd_ids:
            result = await self.session.execute(
                select(OutletFinancialDate).where(
                    OutletFinancialDate.financial_date_id.in_(fd_ids),
                    OutletFinancialDate.outlet_id.in_(outlet_ids),
                    OutletFinancialDate.active.is_(True),
                )
            )
            for ofd in result.scalars():
                ofd_by_outlet.setdefault(ofd.outlet_id, []).append(ofd)

        # Build a fast lookup: date → FinancialDate
        fd_by_date: dict[date, FinancialDate] = {fd.date: fd for fd in fd_rows}

        # Build covariates per outlet purely in Python
        output: dict[str, dict[str, dict[date, float]] | None] = {}
        for outlet_id in outlet_ids:
            weekday_cost = outlet_weekday_cost.get(outlet_id, {})
            weekday_profit = outlet_weekday_profit.get(outlet_id, {})

            # Build outlet-specific override lookup: fd_id → OutletFinancialDate
            ofd_by_fd_id: dict[str, OutletFinancialDate] = {
                ofd.financial_date_id: ofd for ofd in ofd_by_outlet.get(outlet_id, [])
            }

            cost_map: dict[date, float] = {}
            profit_map: dict[date, float] = {}
            current = start_date
            while current <= end_date:
                weekday = current.weekday() + 1

                override_cost: float | None = None
                override_profit: float | None = None
                fd = fd_by_date.get(current)
                if fd is not None:
                    ofd = ofd_by_fd_id.get(fd.id)
                    if ofd is not None:
                        if ofd.cost_per_unit is not None:
                            override_cost = ofd.cost_per_unit
                        if ofd.profit_per_unit is not None:
                            override_profit = ofd.profit_per_unit

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
            output[outlet_id] = covariates or None

        n_with_financials = sum(1 for v in output.values() if v)
        logger.debug(
            "Financial covariates built: %d/%d outlets have cost/profit data "
            "(default_cost=%s, default_profit=%s)",
            n_with_financials, len(outlet_ids), default_cost, default_profit,
        )

        return output

    async def _build_pad_covariates(
        self, customer_id: str
    ) -> dict[str, set[date]] | None:
        """Build pad event date sets split by weekday, for use as Ridge covariates.

        Each PAD is split into up to 7 features — one per weekday — so Ridge learns
        a separate effect per (PAD, weekday) combination. Features are named
        "{pad_name}_dow_{N}" (e.g. "christmas_dow_6" for Christmas on Saturday).
        Only weekdays that actually appear in the PAD's event dates are emitted.
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
            if not event_dates:
                continue
            slug = _slugify(pad.name)
            for dow in range(1, 8):
                dow_dates = {d for d in event_dates if d.weekday() + 1 == dow}
                if dow_dates:
                    pad_map[f"{slug}_dow_{dow}"] = dow_dates

        return pad_map or None

    async def _load_strategy(self, strategy_id: str) -> PredictionStrategy | None:
        """Load an active PredictionStrategy row by ID, eagerly loading its engine."""
        result = await self.session.execute(
            select(PredictionStrategy)
            .where(PredictionStrategy.id == strategy_id, PredictionStrategy.active.is_(True))
            .options(selectinload(PredictionStrategy.prediction_engine))
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _strategy_defaults(strategy: PredictionStrategy) -> dict:
        """Map strategy columns to request parameter names.

        Only non-None / non-False strategy values are included — they act as defaults
        that are overridden by any explicitly set request parameter.
        """
        defaults: dict = {}
        if strategy.increase_total_by_number is not None:
            defaults["increase_total_by"] = int(strategy.increase_total_by_number)
        if strategy.increase_total_by_percentage is not None:
            defaults["increase_total_by_pct"] = float(strategy.increase_total_by_percentage)
        if strategy.increase_outlets_by_number is not None:
            defaults["increase_outlets_by"] = int(strategy.increase_outlets_by_number)
        if strategy.increase_outlets_by_percentage is not None:
            defaults["increase_outlets_by_pct"] = float(strategy.increase_outlets_by_percentage)
        if strategy.fixed_total_draw is not None:
            defaults["fixed_total_delivery"] = int(strategy.fixed_total_draw)
        if strategy.total_return_percentage is not None:
            defaults["total_return_pct"] = float(strategy.total_return_percentage)
        if strategy.ignore_fixed:
            defaults["ignore_fixed"] = True
        if strategy.ignore_minimum:
            defaults["ignore_minimum"] = True
        if strategy.ignore_maximum:
            defaults["ignore_maximum"] = True
        return defaults

    async def _apply_engine_parameters(
        self,
        engine: object,
        engine_slug: str,
        strategy_id: str | None = None,
    ) -> dict[str, str]:
        """Load selected parameters and apply them to *engine*.

        Resolution order (strategy parameters override engine-level ones):
        1. Engine-level selected parameters (prediction_strategy_id IS NULL).
        2. Strategy-level selected parameters (prediction_strategy_id = strategy_id),
           which **override** any engine-level parameter with the same name.

        Returns the resolved parameter dict (empty if none configured).
        """
        # 1. Engine-level params
        result = await self.session.execute(
            select(PredictionEngineParameter)
            .join(
                PredictionEngineModel,
                PredictionEngineParameter.prediction_engine_id == PredictionEngineModel.id,
            )
            .where(
                PredictionEngineModel.slug == engine_slug,
                PredictionEngineParameter.selected.is_(True),
                PredictionEngineParameter.active.is_(True),
                PredictionEngineParameter.prediction_strategy_id.is_(None),
            )
        )
        rows = result.scalars().all()
        params = {row.name: (row.parameter if row.parameter else row.value) for row in rows}

        # 2. Strategy-level overrides
        if strategy_id:
            strat_result = await self.session.execute(
                select(PredictionEngineParameter)
                .join(
                    PredictionEngineModel,
                    PredictionEngineParameter.prediction_engine_id == PredictionEngineModel.id,
                )
                .where(
                    PredictionEngineModel.slug == engine_slug,
                    PredictionEngineParameter.selected.is_(True),
                    PredictionEngineParameter.active.is_(True),
                    PredictionEngineParameter.prediction_strategy_id == strategy_id,
                )
            )
            for row in strat_result.scalars().all():
                params[row.name] = row.parameter if row.parameter else row.value

        if params:
            logger.info("Applying engine parameters for '%s': %s", engine_slug, params)
            engine.apply_parameters(params)
        return params

    async def _resolve_engine(
        self,
        customer_id: str,
        requested: PredictionEngine | None,
        strategy_engine_slug: str | None = None,
    ) -> PredictionEngine:
        """Resolve the prediction engine using the 4-tier fallback chain."""
        # 1. Explicit request parameter wins
        if requested is not None:
            return requested

        # 2. Strategy engine
        if strategy_engine_slug is not None:
            return PredictionEngine(strategy_engine_slug)

        # 3. Customer-level default
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

        # 4. Global application default
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
        return [{"date": row_date, "value": sold} for row_date, sold in sales_data]

    def get_available_engines(self) -> list[PredictionEngine]:
        """Get list of available prediction engines."""
        return self.engine_registry.get_available_engines()

    async def pad_effect(
        self,
        customer_id: str,
        outlet_id: str,
        pad_date: date,
        n_baselines: int = 8,
    ) -> dict:
        """Estimate the PAD effect for one outlet on one event date.

        Compares the model's prediction on pad_date to the average prediction
        on the n_baselines most recent non-PAD days with the same weekday.
        All values come from prediction_outlets joined to predictions.
        """
        from sqlalchemy import extract

        weekday = pad_date.weekday() + 1  # 1=Monday, 7=Sunday
        # PostgreSQL EXTRACT(DOW): 0=Sunday, 1=Monday … 6=Saturday
        pg_dow = pad_date.weekday() + 1 if pad_date.weekday() < 6 else 0

        # Collect all active PAD dates for this customer to exclude from baseline
        pad_result = await self.session.execute(
            select(PadDate.date)
            .join(Pad, Pad.id == PadDate.pad_id)
            .where(Pad.customer_id == customer_id, Pad.active.is_(True), PadDate.active.is_(True))
        )
        all_pad_dates: set[date] = {row[0] for row in pad_result.all()}

        # Prediction on the PAD date
        pad_row = await self.session.execute(
            select(PredictionOutlet.predicted)
            .join(Prediction, Prediction.id == PredictionOutlet.prediction_id)
            .where(
                PredictionOutlet.outlet_id == outlet_id,
                Prediction.customer_id == customer_id,
                Prediction.date == pad_date,
                PredictionOutlet.predicted.isnot(None),
            )
            .order_by(Prediction.created_at.desc())
            .limit(1)
        )
        pad_predicted = pad_row.scalar_one_or_none()

        # Baseline: n most recent non-PAD predictions for the same weekday
        baseline_result = await self.session.execute(
            select(PredictionOutlet.predicted)
            .join(Prediction, Prediction.id == PredictionOutlet.prediction_id)
            .where(
                PredictionOutlet.outlet_id == outlet_id,
                Prediction.customer_id == customer_id,
                extract("dow", Prediction.date) == pg_dow,
                Prediction.date != pad_date,
                Prediction.date.notin_(all_pad_dates),
                PredictionOutlet.predicted.isnot(None),
            )
            .order_by(Prediction.date.desc())
            .limit(n_baselines)
        )
        baseline_values = [row[0] for row in baseline_result.all()]

        baseline_avg = sum(baseline_values) / len(baseline_values) if baseline_values else None
        effect = (pad_predicted - baseline_avg) if pad_predicted is not None and baseline_avg is not None else None
        effect_pct = (effect / baseline_avg * 100) if effect is not None and baseline_avg else None

        return {
            "outlet_id": outlet_id,
            "pad_date": pad_date,
            "weekday": weekday,
            "pad_predicted": pad_predicted,
            "baseline_avg": baseline_avg,
            "effect": effect,
            "effect_pct": round(effect_pct, 2) if effect_pct is not None else None,
            "baseline_count": len(baseline_values),
        }

    async def list_completed(
        self,
        customer_id: str,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """List prediction tasks (success, failure, revoked) for a customer.

        Successful tasks are joined to their prediction rows.
        Failed/cancelled tasks appear as rows with null prediction fields.
        """
        from gorm_ai.database.models.task_record import TaskRecord

        # Get all prediction task_records for this customer (success/failure/revoked)
        tr_stmt = (
            select(TaskRecord)
            .where(
                TaskRecord.customer_id == customer_id,
                TaskRecord.type == "prediction",
                TaskRecord.status.in_(["success", "failure", "revoked"]),
                TaskRecord.active.is_(True),
            )
            .order_by(TaskRecord.completed_at.desc().nulls_last(), TaskRecord.created_at.desc())
        )

        tr_result = await self.session.execute(tr_stmt)
        task_records = list(tr_result.scalars().all())

        total = len(task_records)

        # Apply pagination on task_records
        paged_task_records = task_records[offset : offset + limit]

        if not paged_task_records:
            return [], total

        # For successful task_records, find associated prediction rows (by task_id)
        task_ids = [tr.task_id for tr in paged_task_records]
        pred_by_task: dict[str, list[Prediction]] = {}
        if task_ids:
            pred_result = await self.session.execute(
                select(Prediction)
                .options(
                    selectinload(Prediction.prediction_strategy),
                    selectinload(Prediction.outlet_group),
                )
                .where(
                    Prediction.task_id.in_(task_ids),
                    Prediction.active == True,  # noqa: E712
                )
            )
            for p in pred_result.scalars().all():
                pred_by_task.setdefault(p.task_id, []).append(p)

        # Build outlet counts for all matched predictions
        all_pred_ids = [p.id for preds in pred_by_task.values() for p in preds]
        outlet_counts: dict[str, int] = {}
        if all_pred_ids:
            count_rows = await self.session.execute(
                select(PredictionOutlet.prediction_id, func.count().label("cnt"))
                .where(PredictionOutlet.prediction_id.in_(all_pred_ids))
                .group_by(PredictionOutlet.prediction_id)
            )
            outlet_counts = {row.prediction_id: row.cnt for row in count_rows}

        items = []
        for tr in paged_task_records:
            preds = pred_by_task.get(tr.task_id, [])
            if preds:
                # One row per prediction date (successful task)
                for p in sorted(preds, key=lambda x: x.date):
                    items.append({
                        "id": p.id,
                        "customer_id": customer_id,
                        "status": tr.status,
                        "outlet_group_id": p.outlet_group_id,
                        "outlet_group_name": p.outlet_group.name if p.outlet_group else None,
                        "prediction_strategy_id": p.prediction_strategy_id,
                        "strategy_name": p.prediction_strategy.name if p.prediction_strategy else None,
                        "date": p.date,
                        "engine": p.engine,
                        "requested_engine": p.requested_engine,
                        "engine_params": p.engine_params,
                        "batch_size": p.batch_size,
                        "delay": p.delay,
                        "use_financials": p.use_financials,
                        "use_pad": p.use_pad,
                        "task_id": tr.task_id,
                        "outlet_count": outlet_counts.get(p.id, 0),
                        "error": None,
                        "created_at": tr.completed_at or tr.created_at,
                        "started_at": tr.started_at,
                        "completed_at": tr.completed_at,
                    })
            else:
                # Failed / cancelled task — no prediction rows
                items.append({
                    "id": tr.id,
                    "customer_id": customer_id,
                    "status": tr.status,
                    "outlet_group_id": None,
                    "outlet_group_name": None,
                    "prediction_strategy_id": None,
                    "strategy_name": None,
                    "date": None,
                    "engine": None,
                    "requested_engine": None,
                    "engine_params": None,
                    "batch_size": None,
                    "delay": None,
                    "use_financials": None,
                    "use_pad": None,
                    "task_id": tr.task_id,
                    "outlet_count": 0,
                    "error": tr.error,
                    "created_at": tr.completed_at or tr.created_at,
                    "started_at": tr.started_at,
                    "completed_at": tr.completed_at,
                })

        return items, total

    async def get_analytics(self, prediction_id: str) -> dict:
        """Get aggregate analytics for a completed prediction."""
        result = await self.session.execute(
            select(
                func.count(PredictionOutlet.id).label("outlet_count"),
                func.avg(PredictionOutlet.predicted).label("avg_predicted"),
                func.avg(PredictionOutlet.confidence).label("avg_confidence"),
                func.avg(PredictionOutlet.eo).label("avg_eo"),
                func.sum(PredictionOutlet.delivered).label("total_delivered"),
                func.sum(PredictionOutlet.eo).label("total_eo"),
                func.sum(PredictionOutlet.predicted).label("total_predicted"),
                func.sum(PredictionOutlet.lower_bound).label("total_lower_bound"),
                func.sum(PredictionOutlet.upper_bound).label("total_upper_bound"),
                func.min(PredictionOutlet.predicted).label("min_predicted"),
                func.max(PredictionOutlet.predicted).label("max_predicted"),
            ).where(PredictionOutlet.prediction_id == prediction_id)
        )
        row = result.one()
        return {
            "outlet_count": row.outlet_count or 0,
            "avg_predicted": round(row.avg_predicted, 4) if row.avg_predicted is not None else None,
            "avg_confidence": round(row.avg_confidence, 4) if row.avg_confidence is not None else None,
            "avg_eo": round(row.avg_eo, 4) if row.avg_eo is not None else None,
            "total_delivered": round(row.total_delivered, 2) if row.total_delivered is not None else None,
            "total_eo": round(row.total_eo, 2) if row.total_eo is not None else None,
            "total_predicted": round(row.total_predicted, 2) if row.total_predicted is not None else None,
            "total_lower_bound": round(row.total_lower_bound, 2) if row.total_lower_bound is not None else None,
            "total_upper_bound": round(row.total_upper_bound, 2) if row.total_upper_bound is not None else None,
            "min_predicted": round(row.min_predicted, 4) if row.min_predicted is not None else None,
            "max_predicted": round(row.max_predicted, 4) if row.max_predicted is not None else None,
        }

    async def get_comparison(self, prediction_ids: list[str], customer_id: str) -> list[dict]:
        """Compute comparison metrics for a set of predictions."""
        from sqlalchemy import case as sa_case

        # Get default financials for profit calculation
        cost_per_unit, profit_per_unit = await self._get_default_financials(customer_id)

        # Fetch prediction metadata (name, date)
        pred_result = await self.session.execute(
            select(Prediction)
            .options(selectinload(Prediction.prediction_strategy))
            .where(Prediction.id.in_(prediction_ids), Prediction.active.is_(True))
        )
        preds_by_id = {p.id: p for p in pred_result.scalars().all()}

        items = []
        for pid in prediction_ids:
            pred = preds_by_id.get(pid)
            if not pred:
                continue

            # Aggregate per-outlet metrics in one query
            delivered_col = func.coalesce(PredictionOutlet.delivered, 0.0)
            predicted_col = func.coalesce(PredictionOutlet.predicted, 0.0)
            sale_expr = sa_case(
                (delivered_col < predicted_col, delivered_col),
                else_=predicted_col,
            )

            result = await self.session.execute(
                select(
                    func.count(PredictionOutlet.id).label("cnt"),
                    func.sum(delivered_col).label("draw"),
                    func.sum(predicted_col).label("demand"),
                    func.sum(sale_expr).label("sale"),
                    func.count().filter(predicted_col >= delivered_col).label("sold_out_cnt"),
                ).where(PredictionOutlet.prediction_id == pid)
            )
            row = result.one()

            cnt = row.cnt or 0
            draw = float(row.draw or 0)
            demand = float(row.demand or 0)
            sale = float(row.sale or 0)
            ret = draw - sale
            sold_out_pct = (row.sold_out_cnt / cnt * 100) if cnt > 0 else 0.0

            profit = None
            if cost_per_unit is not None and profit_per_unit is not None:
                profit = round(profit_per_unit * sale - cost_per_unit * ret, 2)

            name = pred.prediction_strategy.name if pred.prediction_strategy else (pred.task_id or pid[:8])

            items.append({
                "id": pid,
                "name": name,
                "date": pred.date,
                "draw": round(draw, 2),
                "expected_demand": round(demand, 2),
                "expected_sale": round(sale, 2),
                "expected_return": round(ret, 2),
                "sold_out_pct": round(sold_out_pct, 2),
                "expected_profit": profit,
            })

        return items

    async def delete_prediction(self, prediction_id: str) -> bool:
        """Soft-delete a prediction (or its task_record if no prediction rows exist)."""
        from gorm_ai.database.models.task_record import TaskRecord

        result = await self.session.execute(
            select(Prediction).where(Prediction.id == prediction_id, Prediction.active == True)  # noqa: E712
        )
        prediction = result.scalar_one_or_none()
        if prediction:
            prediction.active = False
            await self.session.commit()
            return True

        # Fallback: the id may be a task_record.id for a task that succeeded but
        # produced no prediction rows (e.g. all outlets had insufficient history).
        tr_result = await self.session.execute(
            select(TaskRecord).where(
                TaskRecord.id == prediction_id,
                TaskRecord.active.is_(True),
                TaskRecord.type == "prediction",
            )
        )
        task_record = tr_result.scalar_one_or_none()
        if task_record:
            task_record.active = False
            await self.session.commit()
            return True

    @staticmethod
    def _extract_weekday_corrections(
        outlet_ids: list[str],
        ridge_results: list[dict],
    ) -> dict[str, dict[int, float]]:
        """Extract dow_N coefficients from ridge_results keyed by outlet_id → weekday int."""
        result: dict[str, dict[int, float]] = {}
        for outlet_id, ridge_info in zip(outlet_ids, ridge_results):
            if ridge_info is None:
                continue
            day_corrections: dict[int, float] = {}
            for feat_name, coeff in zip(ridge_info["feature_names"], ridge_info["coefficients"]):
                if feat_name.startswith("dow_"):
                    dow = int(feat_name.split("_")[1])
                    day_corrections[dow] = coeff
            if day_corrections:
                result[outlet_id] = day_corrections
        return result

    async def _persist_covariate_outlets(
        self,
        outlet_ids: list[str],
        ridge_results: list[dict],
        task_id: str | None,
    ) -> None:
        """Persist Ridge regression coefficients (and intercept) per outlet.

        For each outlet a row is written to covariate_outlet for every feature
        coefficient plus the intercept. Covariate definition rows are created
        on first encounter (keyed by name).
        """
        now = datetime.now(UTC)

        # Build a name→Covariate cache to avoid repeated SELECTs.
        covariate_cache: dict[str, Covariate] = {}

        async def _get_or_create_covariate(name: str) -> Covariate:
            if name in covariate_cache:
                return covariate_cache[name]
            result = await self.session.execute(
                select(Covariate).where(Covariate.name == name)
            )
            cov = result.scalar_one_or_none()
            if cov is None:
                cov_type, pad_id, description = _classify_covariate(name)
                cov = Covariate(
                    name=name,
                    type=cov_type,
                    pad_id=pad_id,
                    description=description,
                )
                self.session.add(cov)
                await self.session.flush()
            covariate_cache[name] = cov
            return cov

        # Delete all existing rows for these outlets in one shot, then flush,
        # before any inserts — avoids autoflush ordering issues.
        active_outlet_ids = [oid for oid, ri in zip(outlet_ids, ridge_results) if ri is not None]
        if active_outlet_ids:
            await self.session.execute(
                delete(CovariateOutlet).where(
                    CovariateOutlet.outlet_id.in_(active_outlet_ids)
                )
            )
            await self.session.flush()

        for outlet_id, ridge_info in zip(outlet_ids, ridge_results):
            if ridge_info is None:
                continue
            feature_names: list[str] = ridge_info["feature_names"]
            coefficients: list[float] = ridge_info["coefficients"]
            intercept: float = ridge_info["intercept"]

            for feat_name, coeff in zip(feature_names, coefficients):
                cov = await _get_or_create_covariate(feat_name)
                if feat_name.startswith("dow_"):
                    weekday = int(feat_name.split("_")[1])
                elif "_dow_" in feat_name:
                    weekday = int(feat_name.rsplit("_dow_", 1)[1])
                else:
                    weekday = None
                self.session.add(CovariateOutlet(
                    covariate_id=cov.id,
                    outlet_id=outlet_id,
                    weekday=weekday,
                    task_id=task_id,
                    computed_at=now,
                    coefficient=coeff,
                ))

            # Intercept
            intercept_cov = await _get_or_create_covariate("intercept")
            self.session.add(CovariateOutlet(
                covariate_id=intercept_cov.id,
                outlet_id=outlet_id,
                weekday=None,
                task_id=task_id,
                computed_at=now,
                coefficient=intercept,
            ))

        await self.session.flush()

    # -------------------------------------------------------------------------
    # Data Dump
    # -------------------------------------------------------------------------

    async def get_data_dump(
        self,
        prediction_id: str,
        *,
        outlet_ids: list[str] | None = None,
        limit: int = 25,
        offset: int = 0,
        sort_by: str = "outlet_name",
        sort_dir: str = "asc",
        search: str | None = None,
    ) -> dict | None:
        """Return per-outlet data for a prediction."""
        from sqlalchemy import func

        pred = await self.session.get(Prediction, prediction_id)
        if not pred or not pred.active:
            return None

        filters: list = [PredictionOutlet.prediction_id == prediction_id]
        if outlet_ids:
            filters.append(PredictionOutlet.outlet_id.in_(outlet_ids))
        if search:
            filters.append(Outlet.name.ilike(f"%{search}%"))

        # Count
        count_query = (
            select(func.count())
            .select_from(PredictionOutlet)
            .join(Outlet, Outlet.id == PredictionOutlet.outlet_id)
            .where(*filters)
        )
        total_count = (await self.session.execute(count_query)).scalar() or 0

        # Sort
        _sort_columns: dict = {
            "outlet_name": Outlet.name,
            "date": Prediction.date,
            "delivered": PredictionOutlet.delivered,
        }
        sort_col = _sort_columns.get(sort_by, Outlet.name)
        order = sort_col.desc() if sort_dir == "desc" else sort_col.asc()

        # Main query
        rows = (
            await self.session.execute(
                select(
                    PredictionOutlet.outlet_id,
                    Outlet.name.label("outlet_name"),
                    Prediction.date,
                    PredictionOutlet.delivered,
                    PredictionOutlet.eo,
                    PredictionOutlet.predicted,
                    PredictionOutlet.actual_sale,
                    PredictionOutlet.lower_bound,
                    PredictionOutlet.q20,
                    PredictionOutlet.q30,
                    PredictionOutlet.q40,
                    PredictionOutlet.q50,
                    PredictionOutlet.q60,
                    PredictionOutlet.q70,
                    PredictionOutlet.q80,
                    PredictionOutlet.upper_bound,
                    PredictionOutlet.cv,
                    Sales.delivered.label("actual_delivered"),
                )
                .join(Prediction, Prediction.id == PredictionOutlet.prediction_id)
                .join(Outlet, Outlet.id == PredictionOutlet.outlet_id)
                .outerjoin(
                    Sales,
                    (Sales.outlet_id == PredictionOutlet.outlet_id)
                    & (Sales.date == Prediction.date),
                )
                .where(*filters)
                .order_by(order, Outlet.name)
                .limit(limit)
                .offset(offset)
            )
        ).all()

        # Financials for profit calculation
        all_oids = list({r.outlet_id for r in rows})
        fin_map: dict[tuple[str, int], tuple[float | None, float | None]] = {}
        if all_oids:
            fin_result = await self.session.execute(
                select(
                    OutletFinancials.outlet_id,
                    OutletFinancials.weekday,
                    OutletFinancials.cost_per_unit,
                    OutletFinancials.profit_per_unit,
                ).where(OutletFinancials.outlet_id.in_(all_oids))
            )
            fin_map = {
                (r.outlet_id, r.weekday): (r.cost_per_unit, r.profit_per_unit)
                for r in fin_result
            }
        default_cost, default_profit = await self._get_default_financials(pred.customer_id)

        import math

        def _safe(v: object) -> float | None:
            """Convert NaN / None to None, otherwise float."""
            if v is None:
                return None
            f = float(v)  # type: ignore[arg-type]
            return None if math.isnan(f) else f

        result_rows = []
        for r in rows:
            actual_draw = _safe(r.actual_delivered)
            actual_sale = _safe(r.actual_sale)
            pred_delivered = _safe(r.delivered)

            sold: float | None = None
            returned: float | None = None
            profit: float | None = None

            if pred_delivered is not None and actual_sale is not None:
                s_draw = max(1, round(pred_delivered))
                sold = float(round(min(s_draw, actual_sale)))
                returned = float(round(max(0.0, s_draw - actual_sale)))

                if actual_draw is not None:
                    weekday = r.date.weekday()
                    cost, profit_unit = fin_map.get((r.outlet_id, weekday), (None, None))
                    _cost = (cost if cost is not None else default_cost) or 0.0
                    _profit = (profit_unit if profit_unit is not None else default_profit) or 0.0

                    if s_draw < actual_draw:
                        reduction = actual_draw - s_draw
                        if s_draw >= actual_sale:
                            profit = reduction * _cost  # G1
                        else:
                            profit = reduction * _cost - (actual_sale - s_draw) * _profit  # G2
                    elif s_draw > actual_draw:
                        a_returned = max(0.0, actual_draw - actual_sale)
                        if a_returned == 0.0:
                            profit = 0.0  # sold-out, simplified
                        else:
                            profit = -(s_draw - actual_draw) * _cost  # G3
            elif pred_delivered is not None:
                s_draw = max(1, round(pred_delivered))

            result_rows.append({
                "outlet_id": r.outlet_id,
                "outlet_name": r.outlet_name,
                "date": r.date,
                "delivered": pred_delivered,
                "sold": sold,
                "returned": returned,
                "q10": _safe(r.lower_bound),
                "q20": _safe(r.q20),
                "q30": _safe(r.q30),
                "q40": _safe(r.q40),
                "q50": _safe(r.q50),
                "q60": _safe(r.q60),
                "q70": _safe(r.q70),
                "q80": _safe(r.q80),
                "q90": _safe(r.upper_bound),
                "eo": _safe(r.eo),
                "cv": _safe(r.cv),
                "profit": profit,
            })

        return {"rows": result_rows, "total_count": total_count}


def _classify_covariate(name: str) -> tuple[str, str | None, str | None]:
    """Return (type, pad_id, description) for a covariate feature name."""
    if name == "intercept":
        return "intercept", None, "Ridge intercept — systematic bias absorbed per outlet"
    if name.startswith("dow_"):
        dow = int(name.split("_")[1])
        day_names = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday"}
        return "weekday", None, f"{day_names.get(dow, f'Weekday {dow}')} vs Sunday baseline"
    if name == "cost_per_unit":
        return "financial", None, "End-user price per unit — demand signal via price elasticity"
    if "_dow_" in name:
        pad_slug, dow_str = name.rsplit("_dow_", 1)
        day_names = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday"}
        return "pad", None, f"PAD '{pad_slug}' effect on {day_names.get(int(dow_str), f'weekday {dow_str}')}"
    return "unknown", None, None


def _slugify(text: str) -> str:
    """Convert a human-readable name to a lowercase underscore slug."""
    import re
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
