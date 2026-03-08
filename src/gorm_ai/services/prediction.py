"""Prediction service for managing predictions."""

import heapq
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import math

ProgressCallback = Callable[[int, str | None], Awaitable[None]]

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.financial_date import FinancialDate, OutletFinancialDate
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_delivery import OutletDelivery
from gorm_ai.database.models.outlet_financials import OutletFinancials
from gorm_ai.database.models.outlet_group import OutletGroupMember
from gorm_ai.database.models.pad import Pad
from gorm_ai.database.models.prediction import Prediction
from gorm_ai.database.models.prediction_outlet import PredictionOutlet
from gorm_ai.database.models.prediction_strategy import PredictionStrategy
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
        if request.prediction_strategy_id:
            strategy = await self._load_strategy(request.prediction_strategy_id)
            if strategy:
                defaults = self._strategy_defaults(strategy)
                updates = {k: v for k, v in defaults.items() if getattr(request, k, None) in (None, False)}
                if updates:
                    request = request.model_copy(update=updates)
                if strategy.prediction_engine:
                    strategy_engine_slug = strategy.prediction_engine.slug

        # Resolve which engine to use (request → strategy → customer config → global config → default)
        engine_type = await self._resolve_engine(request.customer_id, request.engine, strategy_engine_slug)

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

        # Fetch all outlet sales in one query, then process per-outlet in memory
        if on_progress:
            await on_progress(5, f"Loading data ({len(outlet_ids)} outlets)")

        all_sales = await self.sales_service.get_by_date_range_bulk(
            customer_id=request.customer_id,
            outlet_ids=outlet_ids,
            end_date=history_end,
            apply_sales_filter=True,
        )

        # Bulk-fetch financials covariates for all outlets in one pass
        if request.use_financials:
            if on_progress:
                await on_progress(15, "Loading financials")
            cov_end = request.prediction_from + timedelta(days=horizon - 1)
            # Use the earliest sales date across all outlets as the covariate start
            cov_start = min(
                (sales[0].date for sales in all_sales.values() if sales),
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

        # Collect per-outlet inputs (pure in-memory, no DB calls)
        batch_items: list[dict] = []
        valid_outlet_ids: list[str] = []
        covariates_by_outlet: dict[str, dict[str, dict[date, float]] | None] = {}
        for outlet_id in outlet_ids:
            sales_data = all_sales.get(outlet_id, [])
            historical_data = self._prepare_historical_data(sales_data)

            if capabilities.max_history_length and len(historical_data) > capabilities.max_history_length:
                historical_data = historical_data[-capabilities.max_history_length:]

            covariates = all_covariates.get(outlet_id) if request.use_financials else None
            covariates_by_outlet[outlet_id] = covariates
            batch_items.append({
                "historical_data": historical_data,
                "covariates": covariates,
                "pad_dates": pad_covariates,
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

        if on_progress:
            await on_progress(85, "Saving results")

        outlets: list[OutletPrediction] = [
            OutletPrediction(outlet_id=outlet_id, results=results)
            for outlet_id, results in zip(valid_outlet_ids, all_results)
        ]

        actual_engine = engine.get_actual_slug() or engine_type.value
        rounding = await self._resolve_rounding(request.customer_id)
        default_cost, default_profit = await self._get_default_financials(request.customer_id) if request.total_return_pct is not None else (None, None)
        await self._persist_predictions(
            request, actual_engine, valid_outlet_ids, all_results, rounding,
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
        outlet_ids: list[str],
        all_results: list[list[PredictionResult]],
        rounding: int = 1,
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
    ) -> None:
        """Persist one Prediction + N PredictionOutlet rows for each date in the window."""
        # Load delivery constraints for all outlets (weekday → OutletDelivery)
        delivery_map = await self._load_outlet_deliveries(outlet_ids)

        # Group results by date: date → {outlet_id: PredictionResult}
        date_outlet: dict[date, dict[str, PredictionResult]] = {}
        for outlet_id, results in zip(outlet_ids, all_results):
            for r in results:
                date_outlet.setdefault(r.date, {})[outlet_id] = r

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
                engine_params=request.engine_params,
                use_financials=request.use_financials,
                use_pad=request.use_pad,
                batch_size=request.batch_size,
                task_id=task_id,
            )
            self.session.add(prediction)
            await self.session.flush()  # populate prediction.id

            # Compute final delivered quantity for each outlet on this date
            outlet_delivered: dict[str, int] = {}
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
            else:
                # Normal flow: base from _compute_delivered, then distribute any extras
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
                        outlet_delivered[outlet_id] = self._compute_delivered(
                            None, base, delivery, rounding,
                            outlet_increase_num=float(increase_outlets_by or 0),
                            outlet_increase_pct=float(increase_outlets_by_pct or 0),
                            ignore_fixed=ignore_fixed, ignore_minimum=ignore_minimum, ignore_maximum=ignore_maximum,
                        )
                    else:
                        outlet_delivered[outlet_id] = self._compute_delivered(
                            r.economic_optimal, r.predicted_value, delivery, rounding,
                            outlet_increase_num=float(increase_outlets_by or 0),
                            outlet_increase_pct=float(increase_outlets_by_pct or 0),
                            ignore_fixed=ignore_fixed, ignore_minimum=ignore_minimum, ignore_maximum=ignore_maximum,
                        )
                n_extra = increase_total_by or 0
                if increase_total_by_pct:
                    n_extra += round(sum(outlet_delivered.values()) * increase_total_by_pct / 100)
                if n_extra > 0:
                    outlets_data = [
                        (oid, r.predicted_value, r.lower_bound, r.upper_bound, float(outlet_delivered[oid]))
                        for oid, r in outlet_results.items()
                    ]
                    extras = self._distribute_extra_copies(outlets_data, n_extra)
                    for oid, extra in extras.items():
                        outlet_delivered[oid] += extra

            for outlet_id, r in outlet_results.items():
                delivery = delivery_map.get(outlet_id, {}).get(weekday)
                self.session.add(PredictionOutlet(
                    prediction_id=prediction.id,
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
        delivery: OutletDelivery | None,
        rounding: int = 1,
        outlet_increase_num: float = 0.0,
        outlet_increase_pct: float = 0.0,
        ignore_fixed: bool = False,
        ignore_minimum: bool = False,
        ignore_maximum: bool = False,
    ) -> int:
        """Apply outlet delivery constraints to arrive at the final delivered quantity.

        Uses eo (economic optimal) as the base when available, falling back to
        predicted_value when eo is None (no financial data configured).

        Per-outlet increases (outlet_increase_num / outlet_increase_pct) are applied
        to the base BEFORE delivery constraints. Precedence of constraints (highest first):
          1. fixed    — overrides everything
          2. minimum  — clamp up
             maximum  — clamp down
          3. add      — add fixed amount
             add_pct  — multiply by (1 + pct/100); applied after add

        rounding: 1=round (default), 2=ceil, 3=floor
        """
        import math

        def _round(v: float) -> int:
            if rounding == 2:
                return max(1, math.ceil(v))
            if rounding == 3:
                return max(1, math.floor(v))
            return max(1, round(v))

        base = eo if eo is not None else predicted

        # Per-outlet increases applied before delivery constraints
        if outlet_increase_num:
            base += outlet_increase_num
        if outlet_increase_pct:
            base += base * outlet_increase_pct / 100.0

        if delivery is None:
            return _round(base)

        # 1. Fixed override
        if not ignore_fixed and delivery.fixed is not None:
            return _round(delivery.fixed)

        delivered = base

        # 2. Min / max clamp
        if not ignore_minimum and delivery.minimum is not None and delivered < delivery.minimum:
            delivered = delivery.minimum
        if not ignore_maximum and delivery.maximum is not None and delivered > delivery.maximum:
            delivered = delivery.maximum

        # 3. Add then add_pct
        if delivery.add is not None:
            delivered += delivery.add
        if delivery.add_pct is not None:
            delivered *= 1.0 + delivery.add_pct / 100.0

        return _round(delivered)

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
                if not ignore_fixed and delivery and delivery.fixed is not None:
                    result[oid] = max(1, round(delivery.fixed))
                    continue
                denom = profit_m[oid] + cost_m[oid] + lam
                r_i = max(0.001, min(0.999, (cost_m[oid] + lam) / denom)) if denom > 0 else (0.001 if lam < 0 else 0.999)
                d = PredictionService._delivered_for_return_pct(r_i * 100.0, p50m[oid], p10m[oid], p90m[oid])
                d = max(0.0, d)
                if not ignore_minimum and delivery and delivery.minimum is not None:
                    d = max(d, float(delivery.minimum))
                if not ignore_maximum and delivery and delivery.maximum is not None:
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
            if not ignore_fixed and delivery and delivery.fixed is not None:
                # Fixed outlets: committed at exactly the fixed amount, excluded from heap
                qty = max(1, round(delivery.fixed))
                delivered[oid] = qty
                committed += qty
            else:
                # Free outlets: start at minimum (or 0), participate in heap
                minimum = round(delivery.minimum) if not ignore_minimum and delivery and delivery.minimum is not None else 0
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
            maximum = round(delivery.maximum) if not ignore_maximum and delivery and delivery.maximum is not None else None

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

    async def _resolve_rounding(self, customer_id: str) -> int:
        """Resolve eo_to_delivery_rounding: customer_configuration → configuration (fallback)."""
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
        if gc:
            return gc.eo_to_delivery_rounding

        return 1  # default: round

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
                FinancialDate.end_date >= start_date,
                FinancialDate.start_date <= end_date,
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

        # Build a fast lookup: financial_date_id → FinancialDate
        fd_by_id = {fd.id: fd for fd in fd_rows}

        # Build covariates per outlet purely in Python
        output: dict[str, dict[str, dict[date, float]] | None] = {}
        for outlet_id in outlet_ids:
            weekday_cost = outlet_weekday_cost.get(outlet_id, {})
            weekday_profit = outlet_weekday_profit.get(outlet_id, {})

            # Build outlet-specific override lookup: (fd_id) → OutletFinancialDate
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
                for fd in fd_rows:
                    if fd.weekday == weekday and fd.start_date <= current <= fd.end_date:
                        ofd = ofd_by_fd_id.get(fd.id)
                        if ofd is not None:
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
            output[outlet_id] = covariates or None

        return output

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
        from gorm_ai.database.models.prediction_strategy import PredictionStrategy as PSModel
        from gorm_ai.database.models.task_record import TaskRecord

        # Get all prediction task_records for this customer (success/failure/revoked)
        tr_stmt = (
            select(TaskRecord)
            .where(
                TaskRecord.customer_id == customer_id,
                TaskRecord.type == "prediction",
                TaskRecord.status.in_(["success", "failure", "revoked"]),
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
                        "engine_params": p.engine_params,
                        "batch_size": p.batch_size,
                        "delay": p.delay,
                        "use_financials": p.use_financials,
                        "use_pad": p.use_pad,
                        "outlet_count": outlet_counts.get(p.id, 0),
                        "error": None,
                        "created_at": tr.completed_at or tr.created_at,
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
                    "engine_params": None,
                    "batch_size": None,
                    "delay": None,
                    "use_financials": None,
                    "use_pad": None,
                    "outlet_count": 0,
                    "error": tr.error,
                    "created_at": tr.completed_at or tr.created_at,
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

    async def delete_prediction(self, prediction_id: str) -> bool:
        """Soft-delete a prediction."""
        result = await self.session.execute(
            select(Prediction).where(Prediction.id == prediction_id, Prediction.active == True)  # noqa: E712
        )
        prediction = result.scalar_one_or_none()
        if not prediction:
            return False
        prediction.active = False
        await self.session.commit()
        return True
