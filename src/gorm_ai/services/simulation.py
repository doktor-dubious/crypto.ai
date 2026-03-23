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
from gorm_ai.database.models.sales_filter import SalesFilter
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

# ---------------------------------------------------------------------------
# Ln(2) constant used to calibrate exponential tail decay.
# When survival = exp(-LN2/scale * excess), it halves every `scale` units.
# ---------------------------------------------------------------------------
_LN2 = 0.6931471805599453


def _demand_variability(quantiles: list[float]) -> float:
    """Estimate the demand variability (scale) from the quantile spread.

    We use the inter-quartile range (IQR) as the primary measure of how
    much demand varies.  The IQR is robust to outliers and captures the
    "typical" spread of the distribution.

    Quantile indices:  0=Q10, 1=Q20, 2=Q30, 3=Q40, 4=Q50,
                       5=Q60, 6=Q70, 7=Q80, 8=Q90

    IQR approximation: Q70 - Q30  (indices 6 and 2).
    This spans the middle 40% of the distribution (P30–P70).

    Fallbacks for degenerate (very narrow) distributions:
      1. Q90 - Q10  (full 80% range)
      2. 10% of Q50  (absolute fallback for near-constant demand)
      3. Minimum of 0.5 to avoid divide-by-zero or infinite tails
    """
    iqr = quantiles[6] - quantiles[2]  # Q70 - Q30
    if iqr > 0:
        return iqr

    # Fallback 1: full range Q90-Q10
    full_range = quantiles[8] - quantiles[0]
    if full_range > 0:
        return full_range

    # Fallback 2: fraction of the median
    return max(0.5, quantiles[4] * 0.10)


def _build_posterior_survival(
    actual_sale: float,
    quantiles: list[float],
) -> Callable[[float], float]:
    """Build a posterior survival function anchored at the sold-out point.

    === Why we don't use classical Bayesian conditioning here ===

    The naive Bayesian approach is:

        P(demand >= q | demand >= actual_sale)
            = P_prior(demand >= q) / P_prior(demand >= actual_sale)

    This is mathematically correct IF the prior CDF perfectly represents
    the true demand distribution.  In practice it fails because:

    1. The prior CDF is an approximation built from only 9 quantile
       points (Q10–Q90) with piecewise-linear interpolation.

    2. When actual_sale is at or near Q90 (the 90th percentile), the
       prior says P(demand >= actual_sale) ≈ 10%.  Conditioning on this
       renormalizes a very thin slice of the prior tail, amplifying any
       errors in the tail shape.

    3. The observation "outlet sold out at actual_sale" is strong evidence
       that the forecast underestimated demand for this outlet on this
       day.  Classical conditioning preserves the prior's thin tail shape
       — it doesn't account for the fact that the model was likely wrong
       about the demand level.

    Example:  Q10–Q90 = [1.5, 1.8, 2.0, 2.1, 2.3, 2.4, 2.6, 2.7, 3.0]
    Outlet sold out at 3 (= Q90).
    Naive conditioning gives P(demand >= 4 | demand >= 3) ≈ 10%.
    But the observation tells us demand was AT LEAST 3 — the forecast was
    wrong.  We should give meaningful probability to demand being 4+.

    === What we do instead: observation-anchored posterior tail ===

    We treat the sold-out point (actual_sale) as a known floor for demand
    and build an exponential survival curve starting from that floor:

        P(demand >= actual_sale + k) = exp(-lambda * k)

    where lambda = ln(2) / variability.

    The "variability" is derived from the forecast's inter-quartile range
    (IQR = Q70 - Q30).  This captures the model's estimate of demand
    SPREAD without relying on where the model placed the demand LEVEL.

    The key insight: even when the model was wrong about the level, its
    estimate of spread (how much demand varies day-to-day) is still
    informative.

    Properties:
    - P(demand >= actual_sale) = 1.0  (we know this — the outlet sold out)
    - Survival halves every `variability` units above actual_sale
    - Does not depend on where actual_sale falls in the prior CDF
    - Heavier tail than naive conditioning when the prior underestimated

    Example with IQR = 0.6 (Q70=2.6, Q30=2.0):
      lambda = ln(2) / 0.6 ≈ 1.155
      P(demand >= 4 | sold out at 3) = exp(-1.155 * 1) ≈ 0.315  (32%)
      P(demand >= 5 | sold out at 3) = exp(-1.155 * 2) ≈ 0.099  (10%)

    Compare naive conditioning: P(demand >= 4) ≈ 10%, P(demand >= 5) ≈ 1%
    """
    variability = _demand_variability(quantiles)

    # Lambda controls how fast survival drops per unit above actual_sale.
    # Survival halves every `variability` units.
    _lambda = _LN2 / variability

    def survival(x: float) -> float:
        """P(demand >= x | demand >= actual_sale).

        Returns 1.0 at x = actual_sale, decays exponentially above.
        Returns 1.0 for x < actual_sale (certain — demand already exceeded it).
        """
        excess = x - actual_sale
        if excess <= 0:
            return 1.0
        return math.exp(-_lambda * excess)

    return survival


def expected_extra_sales(
    actual_sale: float,
    scenario_draw: float,
    quantiles: list[float] | None,
) -> float:
    """Estimate expected extra units sold if more stock had been available.

    Called only when the outlet sold out (demand >= actual_sale, zero returns).
    Uses the posterior survival function to estimate the probability of
    selling each additional unit from actual_sale+1 up to scenario_draw.

    The expected extra sales is the sum of survival probabilities:

        E[extra] = sum_{k=1}^{N} P(demand >= actual_sale + k)

    where N = scenario_draw - actual_sale.

    Each term P(demand >= actual_sale + k) represents the probability that
    demand is high enough to sell the k-th additional unit.  Summing these
    gives the expected number of extra units sold (by linearity of
    expectation).

    Falls back to a simple binary count (round(diff)) when quantiles are
    unavailable — this assumes all extra units would sell with certainty.
    """
    diff = scenario_draw - actual_sale
    if diff <= 0:
        return 0.0

    if quantiles is None or len(quantiles) != 9:
        return round(diff)

    survival = _build_posterior_survival(actual_sale, quantiles)

    total = 0.0
    start = int(actual_sale) + 1
    end = int(scenario_draw)
    for q in range(start, end + 1):
        total += survival(float(q))

    return total


def expected_extra_sales_detailed(
    actual_sale: float,
    scenario_draw: float,
    quantiles: list[float] | None,
) -> tuple[float, list[tuple[int, float]]]:
    """Like expected_extra_sales but also returns per-unit probabilities.

    Returns:
        (total_expected_extra_sales, [(unit, survival_prob), ...])

    The per-unit probabilities show P(demand >= unit) for each integer
    unit from actual_sale+1 to scenario_draw.  These are displayed in the
    simulation detail view so the user can see how confidence drops for
    each additional unit.
    """
    diff = scenario_draw - actual_sale
    if diff <= 0:
        return 0.0, []

    if quantiles is None or len(quantiles) != 9:
        n = round(diff)
        return float(n), [(q, 1.0) for q in range(
            int(actual_sale) + 1, int(actual_sale) + 1 + int(n),
        )]

    survival = _build_posterior_survival(actual_sale, quantiles)

    total = 0.0
    unit_probs: list[tuple[int, float]] = []
    start = int(actual_sale) + 1
    end = int(scenario_draw)
    for q in range(start, end + 1):
        prob = survival(float(q))
        total += prob
        unit_probs.append((q, round(prob, 4)))

    return total, unit_probs


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
        resume_simulation_id: str | None = None,
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

        # --- Create or resume the Simulation DB record ---
        if resume_simulation_id:
            sim_record = await self.session.get(SimulationModel, resume_simulation_id)
            if not sim_record or not sim_record.active:
                raise ValueError("Simulation not found for resume")
            sim_record.task_id = task_id
            sim_record.started_at = datetime.now(UTC)
            sim_record.ended_at = None
            await self.session.flush()
            await self.session.commit()
        else:
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
        variation_params = await self._prediction_service._resolve_variation_adjustment(request.customer_id)
        weekday_only_flags = await self._prediction_service._resolve_weekday_only(request.customer_id)
        open_days_flags = await self._prediction_service._resolve_open_days(request.customer_id)

        # --- Per-outlet closed days (same logic as in PredictionService) ---
        # Build a set of python weekdays (0-6) that are closed for each outlet,
        # based on OutletDelivery.open flags.  Used to:
        #   1. Filter historical data so the engine doesn't see closed-day zeros
        #   2. Skip closed-day results in the per-outlet accumulation loop
        outlet_closed_days: dict[str, set[int]] = {}
        for oid, wd_map in delivery_map.items():
            # OutletDelivery.weekday: 1-7 (Mon=1) → Python weekday: 0-6 (Mon=0)
            closed = {wd - 1 for wd, od in wd_map.items() if not od.open}
            has_open = any(od.open for od in wd_map.values())
            if closed and has_open:
                outlet_closed_days[oid] = closed

        # Load sales filter date ranges so we can skip filtered dates
        _sf_result = await self.session.execute(
            select(SalesFilter.from_date, SalesFilter.to_date).where(
                SalesFilter.customer_id == request.customer_id,
                SalesFilter.active.is_(True),
            )
        )
        sales_filter_ranges: list[tuple[date, date]] = [
            (row.from_date, row.to_date) for row in _sf_result.all()
        ]

        # Per-outlet scalar accumulators — avoids holding all SimulationDayResult objects in RAM
        outlet_profit_acc: dict[str, float] = {oid: 0.0 for oid in outlet_ids}
        outlet_potential_acc: dict[str, float] = {oid: 0.0 for oid in outlet_ids}
        outlet_group_counts_acc: dict[str, dict[int, int]] = {oid: {1: 0, 2: 0, 3: 0, 4: 0} for oid in outlet_ids}
        outlet_eco_profit_acc: dict[str, float] = {oid: 0.0 for oid in outlet_ids}
        outlet_eco_potential_acc: dict[str, float] = {oid: 0.0 for oid in outlet_ids}
        outlet_eco_group_counts_acc: dict[str, dict[int, int]] = {oid: {1: 0, 2: 0, 3: 0, 4: 0} for oid in outlet_ids}
        outlet_has_data: set[str] = set()
        total_days_processed = 0
        engine_fell_back = False

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

        # Track prediction/actual date overlap for data-quality warnings
        _dates_with_actuals: set[date] = set()
        _dates_with_predictions: set[date] = set()

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

                # Filter out days this specific outlet is closed (per-outlet open days).
                # Without this, closed-day zeros pollute the training data.
                closed_wds = outlet_closed_days.get(outlet_id)
                if closed_wds:
                    historical_data = [
                        row for row in historical_data
                        if row["date"].weekday() not in closed_wds
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
                    "variation_adjustment": variation_params,
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

            # Detect engine fallback and flag it on the simulation record (once)
            if not is_same_draw and actual_engine != engine_type.value and not engine_fell_back:
                engine_fell_back = True
                log.warning(
                    "simulation.engine_fallback",
                    simulation_id=sim_record_id,
                    requested_engine=engine_type.value,
                    actual_engine=actual_engine,
                )
                _sr = await self.session.get(SimulationModel, sim_record_id)
                _sr.actual_engine = actual_engine
                await self.session.flush()

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
                    # Skip days the publication is closed
                    if not open_days_flags[pred_date.weekday()]:
                        continue
                    # Skip dates covered by sales filters
                    if any(sf_from <= pred_date <= sf_to for sf_from, sf_to in sales_filter_ranges):
                        continue

                    # Remove outlets that are closed on this weekday (per-outlet open days).
                    # This prevents closed-day predictions from affecting simulation metrics.
                    py_wd = pred_date.weekday()  # 0-6
                    if outlet_closed_days:
                        outlet_results = {
                            oid: r for oid, r in outlet_results.items()
                            if py_wd not in outlet_closed_days.get(oid, set())
                        }
                        if not outlet_results:
                            continue

                    weekday = py_wd + 1  # 1=Monday, 7=Sunday

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
                    _dates_with_predictions.add(pred_date)

                    for outlet_id, r in outlet_results.items():
                        delivery = delivery_map.get(outlet_id, {}).get(weekday)
                        oc = chunk_weekday_corrections.get(outlet_id, {})
                        q = r.quantiles  # [P10..P90] or None
                        self.session.add(PredictionOutlet(
                            prediction_id=pred_record.id,
                            outlet_id=outlet_id,
                            predicted=r.predicted_value,
                            lower_bound=r.lower_bound,
                            upper_bound=r.upper_bound,
                            confidence=r.confidence,
                            eo=r.economic_optimal,
                            cv=r.cv,
                            delivered=outlet_delivered[outlet_id],
                            actual_sale=chunk_actuals.get((pred_date, outlet_id)),
                            q20=q[1] if q else None,
                            q30=q[2] if q else None,
                            q40=q[3] if q else None,
                            q50=q[4] if q else None,
                            q60=q[5] if q else None,
                            q70=q[6] if q else None,
                            q80=q[7] if q else None,
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
                _dates_with_actuals.update(
                    d for d, s in actual_by_date.items()
                    if s.sold is not None or s.delivered is not None
                )
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

                    # --- Accumulate scenario stats (deferred until after sold-out logic) ---
                    _acc_scenario_delivered = actual_sale is not None

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
                            p_more = expected_extra_sales(actual_sale, p_draw, pred.quantiles)
                            p_sold_if = actual_sale + p_more
                            p_return_if = 0.0
                            p_loss = 0
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
                                pred_g_profit[4] += p_more * _profit - increase * _cost
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
                            eo_more = expected_extra_sales(actual_sale, eo_draw, pred.quantiles)
                            eo_sold_if = actual_sale + eo_more
                            eo_return_if = 0.0
                            eo_loss = 0
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
                                eo_g_profit[4] += eo_more * _profit - increase * _cost
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
                            more_sale = expected_extra_sales(actual_sale, adj_draw, pred.quantiles)
                            sold_if_delivered = actual_sale + more_sale
                            return_if_delivered = 0.0
                            loss_sale = 0
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
                                deliv_g_profit[4] += more_sale * _profit - increase * _cost
                            else:
                                # G3: bad increase — outlet had unsold copies, extra copies wasted
                                deliv_g_profit[3] -= increase * _cost

                    # Now accumulate scenario totals using sold-out-aware values
                    if _acc_scenario_delivered:
                        delivered_total_delivered += round(adj_draw)
                        if actual_draw is not None:
                            # Use the sold-out-corrected values computed above
                            delivered_total_sold += round(sold_if_delivered)
                            delivered_total_returned += round(max(0.0, adj_draw - sold_if_delivered))
                        else:
                            # No actual_draw → can't determine sold-out, use naive
                            delivered_total_sold += round(min(adj_draw, actual_sale))
                            delivered_total_returned += round(max(0.0, adj_draw - actual_sale))

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

        # --- Data-quality warnings ---
        sim_warnings: list[str] = []
        if _dates_with_actuals and _dates_with_predictions:
            overlap = _dates_with_actuals & _dates_with_predictions
            if not overlap:
                actual_weekdays = sorted({d.strftime("%A") for d in _dates_with_actuals})
                pred_weekdays = sorted({d.strftime("%A") for d in _dates_with_predictions})
                sim_warnings.append(
                    f"No date overlap between predictions ({', '.join(pred_weekdays)}) "
                    f"and actual sales data ({', '.join(actual_weekdays)}). "
                    f"The delivered scenario results are unreliable. "
                    f"Check the customer's open-days configuration."
                )
                log.warning(
                    "simulation.no_date_overlap",
                    simulation_id=sim_record_id,
                    prediction_weekdays=pred_weekdays,
                    actual_weekdays=actual_weekdays,
                    prediction_dates_count=len(_dates_with_predictions),
                    actual_dates_count=len(_dates_with_actuals),
                )
            else:
                overlap_pct = len(overlap) / len(_dates_with_actuals) * 100
                if overlap_pct < 50:
                    sim_warnings.append(
                        f"Only {overlap_pct:.0f}% of actual sales dates have matching predictions. "
                        f"Simulation results may be unreliable."
                    )

        # --- Persist aggregated stats to the Simulation record ---
        sim_record.ended_at = datetime.now(UTC)
        sim_record.warnings = sim_warnings or None

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
            actual_engine=sim_record.actual_engine,
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
    # Resume
    # -------------------------------------------------------------------------

    async def _get_last_completed_date(self, simulation_id: str) -> date | None:
        """Return the latest prediction date already processed for a simulation."""
        from sqlalchemy import func as sqlfunc

        result = await self.session.execute(
            select(sqlfunc.max(PredictionModel.date))
            .join(SimulationDateModel, SimulationDateModel.prediction_id == PredictionModel.id)
            .where(SimulationDateModel.simulation_id == simulation_id)
        )
        return result.scalar_one_or_none()

    async def resume_simulation(
        self,
        simulation_id: str,
        task_id: str | None = None,
        on_progress: Callable[[int, str], Coroutine[Any, Any, None]] | None = None,
    ) -> SimulationResponse:
        """Resume a failed or cancelled simulation from where it left off."""
        sim = await self.session.get(SimulationModel, simulation_id)
        if not sim or not sim.active:
            raise ValueError("Simulation not found")

        last_date = await self._get_last_completed_date(simulation_id)
        if last_date:
            # Align to next week boundary — chunks are 7-day aligned from simulation_from
            days_done = (last_date - sim.simulation_from).days + 1
            full_weeks = (days_done + 6) // 7  # round up to completed whole weeks
            resume_from = sim.simulation_from + timedelta(days=full_weeks * 7)
        else:
            resume_from = sim.simulation_from

        if resume_from > sim.simulation_to:
            raise ValueError("Simulation is already complete — nothing to resume")

        # Build a request from the stored simulation parameters
        request = SimulationRequest(
            customer_id=sim.customer_id,
            name=sim.name,
            description=sim.description,
            simulation_from=resume_from,
            simulation_to=sim.simulation_to,
            simulation_type=3 if sim.engine == "same_draw" else 1,
            delay=sim.delay or 14,
            engine=sim.engine if sim.engine != "same_draw" else None,
            outlet_ids=sim.outlet_ids,
            outlet_group_id=sim.outlet_group_id,
            prediction_strategy_id=sim.prediction_strategy_id,
        )

        result = await self.run_simulation(
            request,
            task_id=task_id,
            on_progress=on_progress,
            resume_simulation_id=simulation_id,
        )

        # Recalculate aggregates from the full dataset (old + new chunks)
        await self._recalculate_full_aggregates(simulation_id)

        return result

    async def _recalculate_full_aggregates(self, simulation_id: str) -> None:
        """Recalculate all aggregate stats on the Simulation record from raw data.

        Uses ``get_overview_filtered`` for each scenario (delivered, predicted,
        economic optimal) so g1-g4 profit classification is fully accurate.
        """
        sim = await self.session.get(SimulationModel, simulation_id)
        if not sim:
            return

        d_stats = await self.get_overview_filtered(simulation_id, column="delivered")
        p_stats = await self.get_overview_filtered(simulation_id, column="predicted")
        eo_stats = await self.get_overview_filtered(simulation_id, column="eo")

        if d_stats:
            sim.actual_total_delivered = d_stats["actual_total_delivered"]
            sim.actual_total_sale = d_stats["actual_total_sale"]
            sim.actual_total_returned = d_stats["actual_total_returned"]
            sim.d_total_delivered = d_stats["total_delivered"]
            sim.d_total_sold = d_stats["total_sold"]
            sim.d_total_returned = d_stats["total_returned"]
            sim.d_diff_delivered = d_stats["diff_delivered"]
            sim.d_diff_return = d_stats["diff_return"]
            sim.d_lost_sale = d_stats["lost_sale"]
            sim.d_more_sale = d_stats["more_sale"]
            sim.d_g1 = d_stats["g1"]
            sim.d_g2 = d_stats["g2"]
            sim.d_g3 = d_stats["g3"]
            sim.d_g4 = d_stats["g4"]

        if p_stats:
            sim.p_total_delivered = p_stats["total_delivered"]
            sim.p_total_sold = p_stats["total_sold"]
            sim.p_total_returned = p_stats["total_returned"]
            sim.p_diff_delivered = p_stats["diff_delivered"]
            sim.p_diff_return = p_stats["diff_return"]
            sim.p_lost_sale = p_stats["lost_sale"]
            sim.p_more_sale = p_stats["more_sale"]
            sim.p_g1 = p_stats["g1"]
            sim.p_g2 = p_stats["g2"]
            sim.p_g3 = p_stats["g3"]
            sim.p_g4 = p_stats["g4"]

        if eo_stats and eo_stats.get("total_delivered"):
            sim.eo_total_delivered = eo_stats["total_delivered"]
            sim.eo_total_sold = eo_stats["total_sold"]
            sim.eo_total_returned = eo_stats["total_returned"]
            sim.eo_diff_delivered = eo_stats["diff_delivered"]
            sim.eo_diff_return = eo_stats["diff_return"]
            sim.eo_lost_sale = eo_stats["lost_sale"]
            sim.eo_more_sale = eo_stats["more_sale"]
            sim.eo_g1 = eo_stats["g1"]
            sim.eo_g2 = eo_stats["g2"]
            sim.eo_g3 = eo_stats["g3"]
            sim.eo_g4 = eo_stats["g4"]

        await self.session.flush()

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
                "actual_engine": sim.actual_engine if sim else None,
                "engine_params": sim.engine_params if sim else None,
                "delay": sim.delay if sim else None,
                "outlet_count": outlet_count,
                "outlet_group_id": sim.outlet_group_id if sim else None,
                "outlet_group_name": sim.outlet_group.name if sim and sim.outlet_group else None,
                "prediction_strategy_name": sim.prediction_strategy.name if sim and sim.prediction_strategy else None,
                "error": tr.error,
                "warnings": sim.warnings if sim else None,
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
        outlet_ids: list[str] | None = None,
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
        if outlet_ids:
            filters.append(PredictionOutlet.outlet_id.in_(outlet_ids))

        # Load all relevant rows with actual delivery from sales
        rows_result = await self.session.execute(
            select(
                PredictionOutlet.outlet_id,
                extract("isodow", PredictionModel.date).label("weekday"),
                col_attr.label("scenario_delivery"),
                Sales.delivered.label("actual_delivered"),
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
        scenario_sold_out_count = 0
        scenario_total_count = 0
        actual_sold_out_count = 0
        actual_total_count = 0
        actual_total_delivered = 0.0
        actual_total_sale = 0.0
        actual_total_returned = 0.0
        diff_delivered_total = 0
        diff_return_total = 0
        lost_sale_total = 0
        more_sale_total = 0.0
        g_profit: dict[int, float] = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        has_scenario = False
        has_actual = False

        for r in rows:
            scenario_delivery = r.scenario_delivery
            actual_draw = float(r.actual_delivered) if r.actual_delivered is not None else None
            actual_sale = float(r.actual_sale) if r.actual_sale is not None else None

            # Reconstruct quantiles from stored columns (None if any missing)
            q_vals = [r.lower_bound, r.q20, r.q30, r.q40, r.q50, r.q60, r.q70, r.q80, r.upper_bound]
            row_quantiles = [float(v) for v in q_vals] if all(v is not None for v in q_vals) else None

            if scenario_delivery is not None and actual_sale is not None:
                has_scenario = True
                s_draw = max(1, round(float(scenario_delivery)))

                # Use conservative sold/returned (matches run_simulation logic)
                total_delivered += s_draw
                total_sold += round(min(s_draw, actual_sale))
                s_ret = round(max(0.0, s_draw - actual_sale))
                total_returned += s_ret
                scenario_total_count += 1
                if s_ret == 0:
                    scenario_sold_out_count += 1

                # Diff metrics (require actual_draw)
                if actual_draw is not None:
                    actual_return_val = max(0.0, actual_draw - actual_sale)
                    sold_out = actual_return_val == 0.0

                    if s_draw < actual_sale:
                        s_return_if = 0.0
                        loss_sale = round(s_draw - actual_sale)  # negative
                        more_sale = 0.0
                    elif s_draw > actual_sale and sold_out:
                        more_sale = expected_extra_sales(actual_sale, s_draw, row_quantiles)
                        s_return_if = 0.0
                        loss_sale = 0
                    else:
                        s_return_if = max(0.0, s_draw - actual_sale)
                        loss_sale = 0
                        more_sale = 0.0

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
                            g_profit[4] += more_sale * _profit - increase * _cost
                        else:
                            g_profit[3] -= increase * _cost

            if actual_draw is not None and actual_sale is not None:
                has_actual = True
                actual_total_delivered += actual_draw
                actual_total_sale += actual_sale
                a_ret = max(0.0, actual_draw - actual_sale)
                actual_total_returned += a_ret
                actual_total_count += 1
                if a_ret == 0:
                    actual_sold_out_count += 1

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
            "sold_out_pct": (
                round(scenario_sold_out_count / scenario_total_count * 100, 1)
                if scenario_total_count > 0 else None
            ),
            "actual_sold_out_pct": (
                round(actual_sold_out_count / actual_total_count * 100, 1)
                if actual_total_count > 0 else None
            ),
            "default_cost": default_cost,
            "default_profit": default_profit,
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

        from gorm_ai.database.models.outlet_financials import OutletFinancials

        # Fetch per-outlet rows (not aggregated) so we can compute profit
        rows = await self.session.execute(
            select(
                PredictionModel.date,
                extract("isodow", PredictionModel.date).label("weekday"),
                PredictionOutlet.outlet_id,
                PredictionOutlet.actual_sale,
                PredictionOutlet.delivered,
                PredictionOutlet.eo,
                PredictionOutlet.predicted,
                PredictionOutlet.lower_bound,
                PredictionOutlet.upper_bound,
                Sales.delivered.label("actual_delivered"),
                Sales.sold.label("actual_sold"),
            )
            .join(SimulationDate, SimulationDate.prediction_id == PredictionOutlet.prediction_id)
            .join(PredictionModel, PredictionModel.id == PredictionOutlet.prediction_id)
            .outerjoin(
                Sales,
                (Sales.outlet_id == PredictionOutlet.outlet_id)
                & (Sales.date == PredictionModel.date),
            )
            .where(*filters)
            .order_by(PredictionModel.date)
        )
        raw_rows = rows.all()

        # Load financials
        all_outlet_ids = list({r.outlet_id for r in raw_rows})
        fin_result = await self.session.execute(
            select(
                OutletFinancials.outlet_id,
                OutletFinancials.weekday,
                OutletFinancials.cost_per_unit,
                OutletFinancials.profit_per_unit,
            ).where(OutletFinancials.outlet_id.in_(all_outlet_ids))
        ) if all_outlet_ids else None
        fin_map: dict[tuple[str, int], tuple[float | None, float | None]] = {}
        if fin_result:
            fin_map = {
                (r.outlet_id, r.weekday): (r.cost_per_unit, r.profit_per_unit)
                for r in fin_result
            }
        default_cost, default_profit = await self._get_default_financials(
            sim.customer_id
        )

        # Aggregate by date
        from collections import defaultdict
        date_agg: dict[date, dict] = {}
        for r in raw_rows:
            d = r.date
            if d not in date_agg:
                date_agg[d] = {
                    "actual_sale": 0.0, "delivered": 0.0, "eo": 0.0, "predicted": 0.0,
                    "lower_bound": 0.0, "upper_bound": 0.0,
                    "actual_delivered": 0.0, "actual_sold": 0.0,
                    "sim_delivered": 0.0, "sim_sold": 0.0,
                    "sim_profit": 0.0, "actual_profit": 0.0,
                    "_has_actual": False, "_has_sim": False,
                }
            agg = date_agg[d]
            if r.actual_sale is not None:
                agg["actual_sale"] += float(r.actual_sale)
            if r.delivered is not None:
                agg["delivered"] += float(r.delivered)
            if r.eo is not None:
                agg["eo"] += float(r.eo)
            if r.predicted is not None:
                agg["predicted"] += float(r.predicted)
            if r.lower_bound is not None:
                agg["lower_bound"] += float(r.lower_bound)
            if r.upper_bound is not None:
                agg["upper_bound"] += float(r.upper_bound)

            weekday = int(r.weekday)
            cost, profit_unit = fin_map.get(
                (r.outlet_id, weekday), (None, None)
            )
            _cost = (cost if cost is not None else default_cost) or 0.0
            _profit = (profit_unit if profit_unit is not None else default_profit) or 0.0

            # Actual values
            if r.actual_delivered is not None:
                a_del = float(r.actual_delivered)
                a_sold = float(r.actual_sold) if r.actual_sold is not None else 0.0
                a_ret = a_del - a_sold
                agg["actual_delivered"] += a_del
                agg["actual_sold"] += a_sold
                agg["actual_profit"] += a_sold * _profit - a_ret * _cost
                agg["_has_actual"] = True

            # Sim values
            if r.delivered is not None and r.actual_sale is not None:
                s_draw = max(1.0, round(float(r.delivered)))
                s_sold = min(s_draw, float(r.actual_sale))
                s_ret = s_draw - s_sold
                agg["sim_delivered"] += s_draw
                agg["sim_sold"] += s_sold
                agg["sim_profit"] += s_sold * _profit - s_ret * _cost
                agg["_has_sim"] = True

        data = [
            {
                "date": d,
                "actual_sale": agg["actual_sale"] or None,
                "delivered": agg["delivered"] or None,
                "eo": agg["eo"] or None,
                "predicted": agg["predicted"] or None,
                "lower_bound": agg["lower_bound"] or None,
                "upper_bound": agg["upper_bound"] or None,
                "actual_delivered": agg["actual_delivered"] if agg["_has_actual"] else None,
                "actual_sold": agg["actual_sold"] if agg["_has_actual"] else None,
                "actual_returned": (agg["actual_delivered"] - agg["actual_sold"]) if agg["_has_actual"] else None,
                "actual_profit": round(agg["actual_profit"], 2) if agg["_has_actual"] else None,
                "sim_delivered": agg["sim_delivered"] if agg["_has_sim"] else None,
                "sim_sold": agg["sim_sold"] if agg["_has_sim"] else None,
                "sim_returned": (agg["sim_delivered"] - agg["sim_sold"]) if agg["_has_sim"] else None,
                "sim_profit": round(agg["sim_profit"], 2) if agg["_has_sim"] else None,
            }
            for d, agg in sorted(date_agg.items())
        ]

        return {"outlets": outlets, "data": data}

    async def get_data_dump(
        self,
        simulation_id: str,
        column: str = "delivered",
        outlet_ids: list[str] | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
        weekdays: list[int] | None = None,
        limit: int = 25,
        offset: int = 0,
        sort_by: str = "date",
        sort_dir: str = "asc",
        search: str | None = None,
        group: str | None = None,
    ) -> dict | None:
        """Return per-row prediction-outlet data for a simulation."""
        from sqlalchemy import case, extract, func

        from gorm_ai.database.models.outlet_financials import (
            OutletFinancials,
        )
        from gorm_ai.database.models.simulation_date import SimulationDate

        sim = await self.session.get(SimulationModel, simulation_id)
        if not sim or not sim.active:
            return None

        _col_attr = {
            "delivered": PredictionOutlet.delivered,
            "eo": PredictionOutlet.eo,
            "predicted": PredictionOutlet.predicted,
        }
        col_attr = _col_attr.get(column, PredictionOutlet.delivered)

        filters = [SimulationDate.simulation_id == simulation_id]
        if weekdays:
            filters.append(
                extract("isodow", PredictionModel.date).in_(weekdays)
            )
        if outlet_ids:
            filters.append(PredictionOutlet.outlet_id.in_(outlet_ids))
        if from_date:
            filters.append(PredictionModel.date >= from_date)
        if to_date:
            filters.append(PredictionModel.date <= to_date)
        if search:
            filters.append(Outlet.name.ilike(f"%{search}%"))

        # Group filter: classify rows by comparing scenario vs actual delivery
        # s_draw = ROUND(scenario_col), G1: s_draw < actual_delivered AND s_draw >= actual_sale
        # G2: s_draw < actual_delivered AND s_draw < actual_sale
        # G3: s_draw > actual_delivered AND actual_delivered > actual_sale (not sold out)
        # G4: s_draw > actual_delivered AND actual_delivered <= actual_sale (sold out)
        needs_sales_for_filter = group in ("g1", "g2", "g3", "g4")
        group_filters = []
        if needs_sales_for_filter:
            s_draw = func.round(col_attr)
            if group == "g1":
                group_filters = [
                    s_draw < Sales.delivered,
                    s_draw >= PredictionOutlet.actual_sale,
                    Sales.delivered.isnot(None),
                    PredictionOutlet.actual_sale.isnot(None),
                ]
            elif group == "g2":
                group_filters = [
                    s_draw < Sales.delivered,
                    s_draw < PredictionOutlet.actual_sale,
                    Sales.delivered.isnot(None),
                    PredictionOutlet.actual_sale.isnot(None),
                ]
            elif group == "g3":
                group_filters = [
                    s_draw > Sales.delivered,
                    Sales.delivered > PredictionOutlet.actual_sale,
                    Sales.delivered.isnot(None),
                    PredictionOutlet.actual_sale.isnot(None),
                ]
            elif group == "g4":
                group_filters = [
                    s_draw > Sales.delivered,
                    Sales.delivered <= PredictionOutlet.actual_sale,
                    Sales.delivered.isnot(None),
                    PredictionOutlet.actual_sale.isnot(None),
                ]

        # Lightweight count query (includes Sales join only when group filter needs it)
        count_query = (
            select(func.count())
            .select_from(PredictionOutlet)
            .join(
                SimulationDate,
                SimulationDate.prediction_id == PredictionOutlet.prediction_id,
            )
            .join(
                PredictionModel,
                PredictionModel.id == PredictionOutlet.prediction_id,
            )
            .join(
                Outlet,
                Outlet.id == PredictionOutlet.outlet_id,
            )
        )
        if needs_sales_for_filter:
            count_query = count_query.join(
                Sales,
                (Sales.outlet_id == PredictionOutlet.outlet_id)
                & (Sales.date == PredictionModel.date),
            )
        count_query = count_query.where(*filters, *group_filters)
        count_result = await self.session.execute(count_query)
        total_count = count_result.scalar() or 0

        # Sorting
        _sort_columns: dict = {
            "date": PredictionModel.date,
            "outlet_name": Outlet.name,
            "scenario_delivery": col_attr,
        }
        sort_col = _sort_columns.get(sort_by, PredictionModel.date)
        order = sort_col.desc() if sort_dir == "desc" else sort_col.asc()

        # Main paginated query (includes Sales outerjoin for actuals)
        rows_result = await self.session.execute(
            select(
                PredictionOutlet.outlet_id,
                Outlet.name.label("outlet_name"),
                PredictionModel.date,
                extract("isodow", PredictionModel.date).label("weekday"),
                col_attr.label("scenario_delivery"),
                Sales.delivered.label("actual_delivered"),
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
                PredictionOutlet.eo,
            )
            .join(
                SimulationDate,
                SimulationDate.prediction_id
                == PredictionOutlet.prediction_id,
            )
            .join(
                PredictionModel,
                PredictionModel.id == PredictionOutlet.prediction_id,
            )
            .join(
                Outlet,
                Outlet.id == PredictionOutlet.outlet_id,
            )
            .outerjoin(
                Sales,
                (Sales.outlet_id == PredictionOutlet.outlet_id)
                & (Sales.date == PredictionModel.date),
            )
            .where(*filters, *group_filters)
            .order_by(order, Outlet.name)
            .limit(limit)
            .offset(offset)
        )
        rows = rows_result.all()

        # Load financial data
        all_outlet_ids = list({r.outlet_id for r in rows})
        fin_result = await self.session.execute(
            select(
                OutletFinancials.outlet_id,
                OutletFinancials.weekday,
                OutletFinancials.cost_per_unit,
                OutletFinancials.profit_per_unit,
            ).where(OutletFinancials.outlet_id.in_(all_outlet_ids))
        )
        fin_map: dict[tuple[str, int], tuple[float | None, float | None]] = {
            (r.outlet_id, r.weekday): (r.cost_per_unit, r.profit_per_unit)
            for r in fin_result
        }
        default_cost, default_profit = await self._get_default_financials(
            sim.customer_id
        )

        result_rows = []
        for r in rows:
            scenario_delivery = r.scenario_delivery
            actual_draw = (
                float(r.actual_delivered)
                if r.actual_delivered is not None
                else None
            )
            actual_sale = (
                float(r.actual_sale)
                if r.actual_sale is not None
                else None
            )

            s_delivery: float | None = None
            s_sold: float | None = None
            s_returned: float | None = None
            a_returned: float | None = None
            g1 = g2 = g3 = g4 = None
            g4_extra_sales: float | None = None
            g4_profit_unit: float | None = None
            g4_unit_probs: list[tuple[int, float]] | None = None

            # Quantile values
            row_q10 = float(r.lower_bound) if r.lower_bound is not None else None
            row_q20 = float(r.q20) if r.q20 is not None else None
            row_q30 = float(r.q30) if r.q30 is not None else None
            row_q40 = float(r.q40) if r.q40 is not None else None
            row_q50 = float(r.q50) if r.q50 is not None else None
            row_q60 = float(r.q60) if r.q60 is not None else None
            row_q70 = float(r.q70) if r.q70 is not None else None
            row_q80 = float(r.q80) if r.q80 is not None else None
            row_q90 = float(r.upper_bound) if r.upper_bound is not None else None

            if scenario_delivery is not None and actual_sale is not None:
                s_draw = max(1, round(float(scenario_delivery)))
                s_delivery = float(s_draw)
                # Naive defaults — overridden below when sold-out logic applies
                s_sold = float(round(min(s_draw, actual_sale)))
                s_returned = float(round(max(0.0, s_draw - actual_sale)))

                if actual_draw is not None:
                    a_returned = max(0.0, actual_draw - actual_sale)
                    sold_out = a_returned == 0.0

                    cost, profit_unit = fin_map.get(
                        (r.outlet_id, int(r.weekday)), (None, None)
                    )
                    _cost = (cost if cost is not None else default_cost) or 0.0
                    _profit = (
                        profit_unit
                        if profit_unit is not None
                        else default_profit
                    ) or 0.0

                    if s_draw < actual_draw:
                        reduction = actual_draw - s_draw
                        if s_draw >= actual_sale:
                            g1 = reduction * _cost
                        else:
                            g2 = (
                                reduction * _cost
                                - (actual_sale - s_draw) * _profit
                            )
                    elif s_draw > actual_draw:
                        increase = s_draw - actual_draw
                        if sold_out:
                            q_vals = [
                                r.lower_bound, r.q20, r.q30, r.q40,
                                r.q50, r.q60, r.q70, r.q80,
                                r.upper_bound,
                            ]
                            quantiles = (
                                [float(v) for v in q_vals]
                                if all(v is not None for v in q_vals)
                                else None
                            )
                            more_sale, unit_probs = expected_extra_sales_detailed(
                                actual_sale, s_draw, quantiles
                            )
                            g4 = more_sale * _profit - increase * _cost
                            g4_extra_sales = more_sale
                            g4_profit_unit = _profit
                            g4_unit_probs = unit_probs
                            # Correct sold/returned: extra units could sell
                            s_sold = float(round(actual_sale + more_sale))
                            s_returned = float(round(max(0.0, s_draw - actual_sale - more_sale)))
                        else:
                            g3 = -(increase * _cost)
            elif scenario_delivery is not None:
                s_draw = max(1, round(float(scenario_delivery)))
                s_delivery = float(s_draw)

            if actual_draw is not None and actual_sale is not None:
                a_returned = max(0.0, actual_draw - actual_sale)

            result_rows.append(
                {
                    "outlet_id": r.outlet_id,
                    "outlet_name": r.outlet_name,
                    "date": r.date,
                    "scenario_delivery": s_delivery,
                    "scenario_sold": s_sold,
                    "scenario_returned": s_returned,
                    "actual_delivered": actual_draw,
                    "actual_sold": actual_sale,
                    "actual_returned": a_returned,
                    "q10": row_q10,
                    "q20": row_q20,
                    "q30": row_q30,
                    "q40": row_q40,
                    "q50": row_q50,
                    "q60": row_q60,
                    "q70": row_q70,
                    "q80": row_q80,
                    "q90": row_q90,
                    "g1": g1,
                    "g2": g2,
                    "g3": g3,
                    "g4": g4,
                    "g4_extra_sales": g4_extra_sales,
                    "g4_profit_unit": g4_profit_unit,
                    "g4_unit_probs": g4_unit_probs,
                    "cv": float(r.cv) if r.cv is not None else None,
                    "eo": float(r.eo) if r.eo is not None else None,
                }
            )

        return {"rows": result_rows, "total_count": total_count}

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
