"""Elasticity analytics — derives own-price elasticity from persisted Ridge coefficients.

Read-only over data produced by the existing forecast pipeline. Does not modify
any forecast or prediction behaviour; it only reads ``covariate_outlet`` rows
written by ``PredictionService._persist_covariate_outlets`` and ``sales`` rows.

Elasticity interpretation
-------------------------
Every foundation-model engine in this project (TimesFM, the Chronos family,
Sundial, Kairos, TIREX, Flowstate, Yinglong, Toto, Moirai2, and the
AutoGluon-wrapped variants) fits a per-outlet ``Ridge(alpha=1.0,
fit_intercept=True)`` on the residual of the model's forecast vs actual
sales, with price as one covariate. The fitted coefficient is persisted in
``covariate_outlet`` keyed by covariate name. Statistical and Custom
engines do not fit Ridge and contribute nothing to elasticity coverage.

Two coefficient forms have been written over the project's lifetime:

- Legacy ``price_per_unit`` (level form). Linearised at the operating
  point: ``elasticity = beta_price * (mean_price / mean_demand)``.
- Current ``log_price_per_unit`` (log form). The semi-elasticity
  ``∂q/∂(ln p) = beta`` converts directly: ``elasticity = beta / mean_demand``,
  independent of mean price.

When both rows exist for an outlet, the log form is preferred.

Caveats
-------
- Only outlets that have been included in a Ridge-fitting prediction run
  will have a persisted coefficient. Statistical/Custom runs and runs with
  ``covariate_handling="none"`` leave ``covariate_outlet`` untouched.
- When historical price barely varies, the Ridge regulariser shrinks the
  coefficient toward zero and the resulting elasticity may be spurious. The
  ``confidence`` field indicates this.
"""

from datetime import date, timedelta
from typing import TYPE_CHECKING

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.covariate import Covariate, CovariateOutlet
from crypto_ai.database.models.customer_configuration import CustomerConfiguration
from crypto_ai.database.models.outlet import Outlet
from crypto_ai.database.models.outlet_group import OutletGroupMember
from crypto_ai.database.models.price_history import PriceHistory
from crypto_ai.database.models.sales import Sales
from crypto_ai.schemas.elasticity import (
    CoverageState,
    CustomerCoverageSummary,
    CustomerElasticitySummary,
    CustomerPriceRecommendation,
    CustomerPriceScenario,
    CustomerPriceVariation,
    CustomerScenarioOutcome,
    ElasticityConfidence,
    OutletCoverage,
    OutletElasticity,
    OutletPriceRecommendation,
    OutletPriceScenario,
    OutletPriceVariation,
    OutletScenarioOutcome,
    PriceVariationViability,
    ProjectionMode,
    RecommendationStatus,
)

if TYPE_CHECKING:
    pass


DEFAULT_WINDOW_DAYS = 90

# Forecast pipeline currently emits log_price_per_unit. Older persisted
# Ridge runs may carry the legacy level-form name; we prefer the log form
# when both exist for one outlet, and fall back to level otherwise.
LOG_PRICE_COVARIATE_NAME = "log_price_per_unit"
LEVEL_PRICE_COVARIATE_NAME = "price_per_unit"

# Shared thresholds used by both elasticity confidence and price-variation
# viability so the two views of the same data stay in sync.
ADEQUATE_PRICE_CV = 0.05
MARGINAL_PRICE_CV = 0.02
ADEQUATE_MIN_DAYS = 60
MIN_DAYS_FOR_ELASTICITY = 14

# Recommendation sweep — fine grid in [-50%, +50%], 1% steps. Bounded by
# each outlet's own safety range (±5% outside historical extremes) before
# argmax. Confidence below this threshold returns "insufficient_data".
RECOMMENDATION_SWEEP_STEP = 0.01
RECOMMENDATION_BOUND_MIN = -0.5
RECOMMENDATION_BOUND_MAX = 0.5
RECOMMENDATION_MIN_CONFIDENCE: tuple[ElasticityConfidence, ...] = ("high", "medium")


def _mean_of(series: dict[date, float] | None) -> float | None:
    """Mean of a date→value map, ignoring None entries. Returns None when empty."""
    if not series:
        return None
    values = [v for v in series.values() if v is not None]
    if not values:
        return None
    return float(np.mean(values))


def _outlet_display_name(outlet: Outlet) -> str | None:
    """Best display label for an outlet — falls back to ext_id when name is blank."""
    name = (outlet.name or "").strip()
    if name:
        return name
    ext = (outlet.ext_id or "").strip()
    return ext or None


def _is_weekday_driven_price(price_map: dict[date, float]) -> bool:
    """True iff prices vary across weekdays but are constant within each weekday.

    Detects the pathological case where a customer's "price variation" is
    actually a deterministic weekday tier (e.g. Mon–Sat $2, Sun $3) with no
    real price-change events inside the window. The Ridge fit includes
    day-of-week dummies as separate covariates, so when ``price_per_unit``
    is perfectly collinear with one of those dummies the resulting β is a
    regularisation artefact rather than a price-response signal.

    Returns True only when every observed weekday holds exactly one
    distinct price *and* the union across weekdays has at least two — i.e.
    the only variation is the weekday tier itself.
    """
    if not price_map:
        return False
    by_weekday: dict[int, set[float]] = {}
    for d, p in price_map.items():
        if p is None:
            continue
        by_weekday.setdefault(d.weekday(), set()).add(round(p, 6))
    if not by_weekday:
        return False
    all_prices: set[float] = set()
    for prices in by_weekday.values():
        all_prices.update(prices)
    if len(all_prices) < 2:
        return False
    return max(len(prices) for prices in by_weekday.values()) == 1


def _within_weekday_cv(price_map: dict[date, float]) -> float | None:
    """Coefficient of variation of price residuals after demeaning by weekday.

    Many customers price differently per weekday (e.g. Mon–Sat one tier,
    Sunday another). The Ridge fit absorbs that between-weekday tier via
    day-of-week dummies, so the price coefficient is identified solely from
    *within-weekday* variation in price. Computing CV on the raw price
    series mixes the two and inflates the apparent variation.

    Steps:
      1. Group prices by weekday (Mon=0..Sun=6).
      2. Subtract each weekday's own mean from its prices.
      3. CV = std(residuals) / mean(all prices).

    Returns None if fewer than 2 prices are present or the overall mean is
    not positive.
    """
    if not price_map:
        return None
    by_weekday: dict[int, list[float]] = {}
    for d, p in price_map.items():
        if p is None:
            continue
        by_weekday.setdefault(d.weekday(), []).append(float(p))
    if not by_weekday:
        return None
    all_prices: list[float] = []
    residuals: list[float] = []
    for prices in by_weekday.values():
        wd_mean = float(np.mean(prices))
        all_prices.extend(prices)
        residuals.extend(p - wd_mean for p in prices)
    if len(all_prices) < 2:
        return None
    overall_mean = float(np.mean(all_prices))
    if overall_mean <= 0:
        return None
    return float(np.std(residuals, ddof=0) / overall_mean)


def _extract_level_prices(
    covariates: dict[str, dict[date, float]] | None,
) -> dict[date, float]:
    """Return level prices from a covariate bundle.

    Reads ``log_price_per_unit`` and exponentiates it back to level prices.
    Falls back to legacy ``price_per_unit`` when only the level form is
    present (e.g. for callers running against snapshots from before the
    log-price covariate switch).
    """
    if not covariates:
        return {}
    log_map = covariates.get(LOG_PRICE_COVARIATE_NAME)
    if log_map:
        return {d: float(np.exp(v)) for d, v in log_map.items()}
    return covariates.get(LEVEL_PRICE_COVARIATE_NAME, {})


class ElasticityService:
    """Compute own-price elasticity from persisted Ridge coefficients."""

    def __init__(self, session: AsyncSession):
        self.session = session

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    async def get_outlet_elasticity(
        self, outlet_id: str, *, window_days: int = DEFAULT_WINDOW_DAYS
    ) -> OutletElasticity | None:
        """Elasticity for a single outlet, or None if the outlet does not exist."""
        outlet = await self._get_outlet(outlet_id)
        if outlet is None:
            return None
        beta = await self._load_beta_price(outlet_id)
        return await self._build_result(outlet, beta, window_days=window_days)

    async def compute_outlet_scenario(
        self,
        outlet_id: str,
        *,
        adjustment_pcts: list[float],
        window_days: int = DEFAULT_WINDOW_DAYS,
        projection: ProjectionMode = "constant_elasticity",
    ) -> OutletPriceScenario | None:
        """Project price-change scenarios for a single outlet.

        Projection modes:
        - ``constant_elasticity`` (default): ``q₁ = q₀ × (1 + Δ)^ε``.
        - ``linear``: ``q₁ = q₀ × (1 + ε × Δ)``.

        Flags ``extrapolation=True`` when the scenario price is more than 5%
        outside the outlet's historical observed range.
        """
        outlet = await self._get_outlet(outlet_id)
        if outlet is None:
            return None

        beta = await self._load_beta_price(outlet_id)
        latest = await self._latest_sale_date(outlet_id)
        end_date = latest or date.today()
        start_date = end_date - timedelta(days=window_days - 1)

        price_map, cost_map = await self._pricing_series(
            outlet_id=outlet.id,
            customer_id=outlet.customer_id,
            start_date=start_date,
            end_date=end_date,
        )
        mean_demand, n_days = await self._mean_demand(
            outlet_id, start_date=start_date, end_date=end_date
        )
        elasticity_result = self._assemble_result(
            outlet=outlet,
            beta=beta,
            price_map=price_map,
            mean_demand=mean_demand,
            n_days=n_days,
            window_days=window_days,
        )
        mean_cost = _mean_of(cost_map)
        return self._assemble_scenario(
            outlet=outlet,
            elasticity=elasticity_result,
            mean_cost=mean_cost,
            price_values=list(price_map.values()),
            adjustment_pcts=adjustment_pcts,
            window_days=window_days,
            projection=projection,
        )

    async def compute_customer_scenario(
        self,
        customer_id: str,
        *,
        adjustment_pcts: list[float],
        window_days: int = DEFAULT_WINDOW_DAYS,
        include_outlets: bool = False,
        projection: ProjectionMode = "constant_elasticity",
    ) -> CustomerPriceScenario:
        """Project price-change scenarios across all active outlets.

        Aggregates outlet-level projections. Outlets without a usable
        elasticity are excluded from both baseline and scenario totals so
        deltas compare like with like.
        """
        outlets = await self._list_customer_outlets(customer_id)
        outlet_ids = [o.id for o in outlets]
        betas = await self._load_beta_price_bulk(outlet_ids)

        latest_by_outlet = await self._latest_sale_dates_bulk(outlet_ids)
        today = date.today()
        per_outlet_window: dict[str, tuple[date, date]] = {}
        window_groups: dict[tuple[date, date], list[str]] = {}
        for oid in outlet_ids:
            end_date = latest_by_outlet.get(oid) or today
            start_date = end_date - timedelta(days=window_days - 1)
            per_outlet_window[oid] = (start_date, end_date)
            window_groups.setdefault((start_date, end_date), []).append(oid)

        price_maps: dict[str, dict[date, float]] = {}
        cost_maps: dict[str, dict[date, float]] = {}
        for (start_date, end_date), group_ids in window_groups.items():
            p_by_o, c_by_o = await self._pricing_series_bulk(
                outlet_ids=group_ids,
                customer_id=customer_id,
                start_date=start_date,
                end_date=end_date,
            )
            price_maps.update(p_by_o)
            cost_maps.update(c_by_o)

        mean_demand_by_outlet = await self._mean_demand_bulk(per_outlet_window)

        # Per-outlet scenario
        per_outlet_scenarios: list[OutletPriceScenario] = []
        for outlet in outlets:
            price_map = price_maps.get(outlet.id, {})
            cost_map = cost_maps.get(outlet.id, {})
            mean_demand, n_days = mean_demand_by_outlet.get(outlet.id, (None, 0))
            elasticity_result = self._assemble_result(
                outlet=outlet,
                beta=betas.get(outlet.id),
                price_map=price_map,
                mean_demand=mean_demand,
                n_days=n_days,
                window_days=window_days,
            )
            scenario = self._assemble_scenario(
                outlet=outlet,
                elasticity=elasticity_result,
                mean_cost=_mean_of(cost_map),
                price_values=list(price_map.values()),
                adjustment_pcts=adjustment_pcts,
                window_days=window_days,
                projection=projection,
            )
            per_outlet_scenarios.append(scenario)

        # Aggregate across included outlets
        included = [s for s in per_outlet_scenarios if s.elasticity is not None]
        baseline_q = sum(s.mean_demand or 0.0 for s in included)
        baseline_rev = sum(s.baseline_daily_revenue or 0.0 for s in included)
        profits_known = [
            s.baseline_daily_profit for s in included if s.baseline_daily_profit is not None
        ]
        baseline_profit: float | None = sum(profits_known) if profits_known else None

        aggregate: list[CustomerScenarioOutcome] = []
        for idx, delta in enumerate(adjustment_pcts):
            sum_q = 0.0
            sum_rev = 0.0
            sum_profit = 0.0
            any_profit = False
            for s in included:
                outcome = s.scenarios[idx]
                if outcome.scenario_daily_demand is not None:
                    sum_q += outcome.scenario_daily_demand
                if outcome.scenario_daily_revenue is not None:
                    sum_rev += outcome.scenario_daily_revenue
                if outcome.scenario_daily_profit is not None:
                    sum_profit += outcome.scenario_daily_profit
                    any_profit = True

            agg_profit = sum_profit if any_profit else None
            demand_delta_pct = (
                (sum_q - baseline_q) / baseline_q * 100 if baseline_q > 0 else 0.0
            )
            rev_delta_pct = (
                (sum_rev - baseline_rev) / baseline_rev * 100 if baseline_rev > 0 else 0.0
            )
            profit_delta_pct: float | None = None
            if agg_profit is not None and baseline_profit not in (None, 0):
                profit_delta_pct = (agg_profit - baseline_profit) / abs(baseline_profit) * 100

            aggregate.append(
                CustomerScenarioOutcome(
                    adjustment_pct=delta,
                    scenario_daily_demand=sum_q,
                    scenario_daily_revenue=sum_rev,
                    scenario_daily_profit=agg_profit,
                    demand_delta_pct=demand_delta_pct,
                    revenue_delta_pct=rev_delta_pct,
                    profit_delta_pct=profit_delta_pct,
                    n_outlets_included=len(included),
                )
            )

        return CustomerPriceScenario(
            customer_id=customer_id,
            window_days=window_days,
            projection=projection,
            adjustment_pcts=list(adjustment_pcts),
            n_outlets=len(outlets),
            n_outlets_included=len(included),
            n_outlets_excluded=len(outlets) - len(included),
            baseline_daily_demand=baseline_q,
            baseline_daily_revenue=baseline_rev,
            baseline_daily_profit=baseline_profit,
            scenarios=aggregate,
            outlets=per_outlet_scenarios if include_outlets else None,
        )

    async def recommend_outlet_price(
        self, outlet_id: str, *, window_days: int = DEFAULT_WINDOW_DAYS
    ) -> OutletPriceRecommendation | None:
        """Profit-maximising price recommendation for one outlet.

        Sweeps a fine adjustment grid bounded by the outlet's own safe range
        (±5% outside historical extremes) and returns the argmax under the
        constant-elasticity projection. Returns ``None`` if the outlet does
        not exist; otherwise always returns a recommendation object whose
        ``status`` indicates whether a usable optimum was found.
        """
        outlet = await self._get_outlet(outlet_id)
        if outlet is None:
            return None

        beta = await self._load_beta_price(outlet_id)
        latest = await self._latest_sale_date(outlet_id)
        end_date = latest or date.today()
        start_date = end_date - timedelta(days=window_days - 1)

        price_map, cost_map = await self._pricing_series(
            outlet_id=outlet.id,
            customer_id=outlet.customer_id,
            start_date=start_date,
            end_date=end_date,
        )
        mean_demand, n_days = await self._mean_demand(
            outlet_id, start_date=start_date, end_date=end_date
        )
        elasticity_result = self._assemble_result(
            outlet=outlet,
            beta=beta,
            price_map=price_map,
            mean_demand=mean_demand,
            n_days=n_days,
            window_days=window_days,
        )
        return self._assemble_recommendation(
            outlet=outlet,
            elasticity=elasticity_result,
            mean_cost=_mean_of(cost_map),
            price_values=list(price_map.values()),
            window_days=window_days,
        )

    async def recommend_customer_price(
        self,
        customer_id: str,
        *,
        window_days: int = DEFAULT_WINDOW_DAYS,
        include_outlets: bool = False,
    ) -> CustomerPriceRecommendation:
        """Single-knob customer-wide profit-maximising recommendation.

        Sweeps a uniform Δ applied to every included outlet, capped at the
        most-restrictive outlet's safe range. Picks the Δ that maximises
        aggregate projected profit across included outlets.
        """
        outlets = await self._list_customer_outlets(customer_id)
        outlet_ids = [o.id for o in outlets]
        betas = await self._load_beta_price_bulk(outlet_ids)

        latest_by_outlet = await self._latest_sale_dates_bulk(outlet_ids)
        today = date.today()
        per_outlet_window: dict[str, tuple[date, date]] = {}
        window_groups: dict[tuple[date, date], list[str]] = {}
        for oid in outlet_ids:
            end_date = latest_by_outlet.get(oid) or today
            start_date = end_date - timedelta(days=window_days - 1)
            per_outlet_window[oid] = (start_date, end_date)
            window_groups.setdefault((start_date, end_date), []).append(oid)

        price_maps: dict[str, dict[date, float]] = {}
        cost_maps: dict[str, dict[date, float]] = {}
        for (start_date, end_date), group_ids in window_groups.items():
            p_by_o, c_by_o = await self._pricing_series_bulk(
                outlet_ids=group_ids,
                customer_id=customer_id,
                start_date=start_date,
                end_date=end_date,
            )
            price_maps.update(p_by_o)
            cost_maps.update(c_by_o)

        mean_demand_by_outlet = await self._mean_demand_bulk(per_outlet_window)

        # Build per-outlet recommendations + collect inputs needed for the
        # customer-wide sweep (only outlets contributing to aggregate need
        # to be carried forward; the rest get an "insufficient_data" record).
        per_outlet_recos: list[OutletPriceRecommendation] = []
        contribs: list[tuple[float, float, float, float, float, float]] = []
        # Tuple: (eps, q0, p0, mean_cost, safe_min_pct, safe_max_pct)
        for outlet in outlets:
            price_map = price_maps.get(outlet.id, {})
            cost_map = cost_maps.get(outlet.id, {})
            mean_demand, n_days = mean_demand_by_outlet.get(outlet.id, (None, 0))
            elasticity_result = self._assemble_result(
                outlet=outlet,
                beta=betas.get(outlet.id),
                price_map=price_map,
                mean_demand=mean_demand,
                n_days=n_days,
                window_days=window_days,
            )
            mean_cost = _mean_of(cost_map)
            reco = self._assemble_recommendation(
                outlet=outlet,
                elasticity=elasticity_result,
                mean_cost=mean_cost,
                price_values=list(price_map.values()),
                window_days=window_days,
            )
            per_outlet_recos.append(reco)
            if (
                reco.status != "insufficient_data"
                and elasticity_result.elasticity is not None
                and elasticity_result.mean_demand is not None
                and elasticity_result.mean_price is not None
                and mean_cost is not None
                and reco.safe_range_min_adjustment is not None
                and reco.safe_range_max_adjustment is not None
            ):
                contribs.append(
                    (
                        elasticity_result.elasticity,
                        elasticity_result.mean_demand,
                        elasticity_result.mean_price,
                        mean_cost,
                        reco.safe_range_min_adjustment,
                        reco.safe_range_max_adjustment,
                    )
                )

        n_total = len(outlets)
        n_included = len(contribs)
        n_excluded = n_total - n_included

        if not contribs:
            return CustomerPriceRecommendation(
                customer_id=customer_id,
                window_days=window_days,
                status="insufficient_data",
                n_outlets=n_total,
                n_outlets_included=0,
                n_outlets_excluded=n_excluded,
                reason=(
                    "No outlets meet the minimum confidence + cost requirements "
                    "for a recommendation. Run a Ridge-capable engine over more "
                    "outlets and ensure cost data is configured."
                ),
                outlets=per_outlet_recos if include_outlets else None,
            )

        # Customer-wide safe range = intersection across all included outlets.
        safe_min = max(c[4] for c in contribs)
        safe_max = min(c[5] for c in contribs)
        # Always include zero so we can report baseline at exactly Δ=0.
        safe_min = min(safe_min, 0.0)
        safe_max = max(safe_max, 0.0)

        # Aggregate baseline (across included outlets only).
        baseline_revenue = sum(q0 * p0 for _, q0, p0, _, _, _ in contribs)
        baseline_profit = sum(q0 * (p0 - c) for _, q0, p0, c, _, _ in contribs)

        # Sweep customer-wide Δ.
        best_delta = 0.0
        best_profit = baseline_profit
        delta = safe_min
        # Add small epsilon to step counter to avoid floating-point miss of safe_max.
        while delta <= safe_max + RECOMMENDATION_SWEEP_STEP / 2:
            agg_profit = 0.0
            for eps, q0, p0, c, _, _ in contribs:
                p1 = p0 * (1 + delta)
                q1 = q0 * (1 + delta) ** eps
                agg_profit += q1 * (p1 - c)
            if agg_profit > best_profit:
                best_profit = agg_profit
                best_delta = delta
            delta += RECOMMENDATION_SWEEP_STEP

        proj_revenue = sum(
            q0 * (1 + best_delta) ** eps * p0 * (1 + best_delta)
            for eps, q0, p0, _, _, _ in contribs
        )
        uplift_pct: float | None = None
        if abs(baseline_profit) > 1e-9:
            uplift_pct = (best_profit - baseline_profit) / abs(baseline_profit) * 100

        epsilon = RECOMMENDATION_SWEEP_STEP / 2
        if abs(best_delta) < epsilon:
            status: RecommendationStatus = "no_change"
            reason = "Aggregate profit is highest near the current price."
        elif best_delta >= safe_max - epsilon:
            status = "boundary_high"
            reason = (
                f"Aggregate profit keeps rising up to the safe ceiling "
                f"(Δ={best_delta * 100:.1f}%). Customers may be underpriced; "
                "widen the historical range with smaller controlled raises before "
                "extrapolating further."
            )
        elif best_delta <= safe_min + epsilon:
            status = "boundary_low"
            reason = (
                f"Aggregate profit is highest at the safe floor "
                f"(Δ={best_delta * 100:.1f}%). Check the elasticity sign — this "
                "is unusual."
            )
        else:
            status = "recommended"
            reason = None

        return CustomerPriceRecommendation(
            customer_id=customer_id,
            window_days=window_days,
            status=status,
            n_outlets=n_total,
            n_outlets_included=n_included,
            n_outlets_excluded=n_excluded,
            baseline_daily_revenue=baseline_revenue,
            baseline_daily_profit=baseline_profit,
            recommended_adjustment_pct=best_delta,
            projected_daily_revenue=proj_revenue,
            projected_daily_profit=best_profit,
            profit_uplift_pct=uplift_pct,
            safe_range_min_adjustment=safe_min,
            safe_range_max_adjustment=safe_max,
            reason=reason,
            outlets=per_outlet_recos if include_outlets else None,
        )

    async def check_outlet_variation(
        self, outlet_id: str, *, window_days: int = DEFAULT_WINDOW_DAYS
    ) -> OutletPriceVariation | None:
        """Price-variation viability for a single outlet."""
        outlet = await self._get_outlet(outlet_id)
        if outlet is None:
            return None

        latest = await self._latest_sale_date(outlet_id)
        end_date = latest or date.today()
        start_date = end_date - timedelta(days=window_days - 1)

        price_map = await self._price_series(
            outlet_id=outlet.id,
            customer_id=outlet.customer_id,
            start_date=start_date,
            end_date=end_date,
        )
        n_days = await self._count_sale_days(outlet_id, start_date, end_date)
        return self._assemble_variation(
            outlet=outlet,
            price_map=price_map,
            n_days=n_days,
            window_days=window_days,
        )

    async def check_customer_variation(
        self, customer_id: str, *, window_days: int = DEFAULT_WINDOW_DAYS
    ) -> CustomerPriceVariation:
        """Aggregated price-variation viability across all active outlets."""
        outlets = await self._list_customer_outlets(customer_id)
        outlet_ids = [o.id for o in outlets]

        latest_by_outlet = await self._latest_sale_dates_bulk(outlet_ids)
        today = date.today()
        per_outlet_window: dict[str, tuple[date, date]] = {}
        window_groups: dict[tuple[date, date], list[str]] = {}
        for oid in outlet_ids:
            end_date = latest_by_outlet.get(oid) or today
            start_date = end_date - timedelta(days=window_days - 1)
            per_outlet_window[oid] = (start_date, end_date)
            window_groups.setdefault((start_date, end_date), []).append(oid)

        price_maps_by_outlet: dict[str, dict[date, float]] = {}
        for (start_date, end_date), group_ids in window_groups.items():
            covariates_by_outlet = await self._price_series_bulk(
                outlet_ids=group_ids,
                customer_id=customer_id,
                start_date=start_date,
                end_date=end_date,
            )
            price_maps_by_outlet.update(covariates_by_outlet)

        days_by_outlet = await self._count_sale_days_bulk(per_outlet_window)

        per_outlet: list[OutletPriceVariation] = []
        counts = {"adequate": 0, "marginal": 0, "insufficient": 0}
        for outlet in outlets:
            price_map = price_maps_by_outlet.get(outlet.id, {})
            n_days = days_by_outlet.get(outlet.id, 0)
            result = self._assemble_variation(
                outlet=outlet,
                price_map=price_map,
                n_days=n_days,
                window_days=window_days,
            )
            per_outlet.append(result)
            counts[result.viability] += 1

        # Overall verdict: adequate if >=50% of outlets are adequate; marginal
        # if >=50% are at least marginal; else insufficient.
        n = len(outlets)
        adequate_frac = counts["adequate"] / n if n else 0
        at_least_marginal = counts["adequate"] + counts["marginal"]
        marginal_frac = at_least_marginal / n if n else 0
        if adequate_frac >= 0.5:
            overall: PriceVariationViability = "adequate"
        elif marginal_frac >= 0.5:
            overall = "marginal"
        else:
            overall = "insufficient"

        deep_last_change, deep_n_distinct = await self._deep_price_summary(
            customer_id
        )

        return CustomerPriceVariation(
            customer_id=customer_id,
            window_days=window_days,
            n_outlets=n,
            n_adequate=counts["adequate"],
            n_marginal=counts["marginal"],
            n_insufficient=counts["insufficient"],
            overall_viability=overall,
            outlets=per_outlet,
            deep_last_change_date=deep_last_change,
            deep_n_distinct_prices=deep_n_distinct,
        )

    async def get_customer_elasticity(
        self, customer_id: str, *, window_days: int = DEFAULT_WINDOW_DAYS
    ) -> CustomerElasticitySummary:
        """Aggregated elasticity across all active outlets for a customer."""
        outlets = await self._list_customer_outlets(customer_id)
        outlet_ids = [o.id for o in outlets]
        betas = await self._load_beta_price_bulk(outlet_ids)

        # Resolve per-outlet window end dates (latest sale) in one query; fall
        # back to today when no sales exist.
        latest_by_outlet = await self._latest_sale_dates_bulk(outlet_ids)

        # Group outlets by (start_date, end_date) so one bulk covariate query
        # covers all outlets sharing the same window. In practice most outlets
        # share the same latest sale date, so this is typically one pass.
        today = date.today()
        per_outlet_window: dict[str, tuple[date, date]] = {}
        window_groups: dict[tuple[date, date], list[str]] = {}
        for oid in outlet_ids:
            end_date = latest_by_outlet.get(oid) or today
            start_date = end_date - timedelta(days=window_days - 1)
            per_outlet_window[oid] = (start_date, end_date)
            window_groups.setdefault((start_date, end_date), []).append(oid)

        # Bulk-resolve price series per window group using the same pipeline as
        # the forecast path.
        price_maps_by_outlet: dict[str, dict[date, float]] = {}
        for (start_date, end_date), group_ids in window_groups.items():
            covariates_by_outlet = await self._price_series_bulk(
                outlet_ids=group_ids,
                customer_id=customer_id,
                start_date=start_date,
                end_date=end_date,
            )
            price_maps_by_outlet.update(covariates_by_outlet)

        # Bulk mean demand per outlet over each outlet's own window.
        mean_demand_by_outlet = await self._mean_demand_bulk(per_outlet_window)

        per_outlet: list[OutletElasticity] = []
        for outlet in outlets:
            start_date, end_date = per_outlet_window[outlet.id]
            price_map = price_maps_by_outlet.get(outlet.id, {})
            mean_demand, n_days = mean_demand_by_outlet.get(outlet.id, (None, 0))
            per_outlet.append(
                self._assemble_result(
                    outlet=outlet,
                    beta=betas.get(outlet.id),
                    price_map=price_map,
                    mean_demand=mean_demand,
                    n_days=n_days,
                    window_days=window_days,
                )
            )

        computed = [
            o.elasticity
            for o in per_outlet
            if o.elasticity is not None and o.confidence != "insufficient_data"
        ]
        median_e = p10_e = p90_e = None
        if computed:
            arr = np.asarray(computed, dtype=float)
            median_e = float(np.median(arr))
            p10_e = float(np.quantile(arr, 0.1))
            p90_e = float(np.quantile(arr, 0.9))

        return CustomerElasticitySummary(
            customer_id=customer_id,
            window_days=window_days,
            n_outlets=len(outlets),
            n_outlets_with_elasticity=len(computed),
            median_elasticity=median_e,
            p10_elasticity=p10_e,
            p90_elasticity=p90_e,
            outlets=per_outlet,
        )

    async def get_customer_coverage(
        self, customer_id: str, *, window_days: int = DEFAULT_WINDOW_DAYS
    ) -> CustomerCoverageSummary:
        """Coverage of persisted Ridge coefficients across customer outlets.

        For each outlet, classifies into one of four states:

        - ``with_log``     — has a ``log_price_per_unit`` coefficient.
        - ``with_legacy``  — has only the legacy ``price_per_unit`` coefficient.
        - ``missing_viable`` — no coefficient yet, but price variation is at
          least marginal so a backfill run will likely produce a usable one.
        - ``missing_not_viable`` — no coefficient and price variation is
          insufficient; a backfill cannot help until price actually moves.
        """
        outlets = await self._list_customer_outlets(customer_id)
        outlet_ids = [o.id for o in outlets]

        betas = await self._load_beta_price_bulk(outlet_ids)

        latest_by_outlet = await self._latest_sale_dates_bulk(outlet_ids)
        today = date.today()
        per_outlet_window: dict[str, tuple[date, date]] = {}
        window_groups: dict[tuple[date, date], list[str]] = {}
        for oid in outlet_ids:
            end_date = latest_by_outlet.get(oid) or today
            start_date = end_date - timedelta(days=window_days - 1)
            per_outlet_window[oid] = (start_date, end_date)
            window_groups.setdefault((start_date, end_date), []).append(oid)

        price_maps_by_outlet: dict[str, dict[date, float]] = {}
        for (start_date, end_date), group_ids in window_groups.items():
            covariates_by_outlet = await self._price_series_bulk(
                outlet_ids=group_ids,
                customer_id=customer_id,
                start_date=start_date,
                end_date=end_date,
            )
            price_maps_by_outlet.update(covariates_by_outlet)

        days_by_outlet = await self._count_sale_days_bulk(per_outlet_window)

        counts = {
            "with_log": 0,
            "with_legacy": 0,
            "missing_viable": 0,
            "missing_not_viable": 0,
        }
        per_outlet: list[OutletCoverage] = []
        for outlet in outlets:
            beta = betas.get(outlet.id)
            price_map = price_maps_by_outlet.get(outlet.id, {})
            n_days = days_by_outlet.get(outlet.id, 0)
            variation = self._assemble_variation(
                outlet=outlet,
                price_map=price_map,
                n_days=n_days,
                window_days=window_days,
            )
            if beta is not None and beta.get("form") == "log":
                state: CoverageState = "with_log"
            elif beta is not None:
                state = "with_legacy"
            elif variation.viability != "insufficient":
                state = "missing_viable"
            else:
                state = "missing_not_viable"
            counts[state] += 1

            per_outlet.append(
                OutletCoverage(
                    outlet_id=outlet.id,
                    outlet_name=_outlet_display_name(outlet),
                    state=state,
                    viability=variation.viability,
                    n_days_observed=variation.n_days_observed,
                    price_cv=variation.price_cv,
                    within_weekday_cv=variation.within_weekday_cv,
                    computed_at=beta["computed_at"] if beta else None,
                )
            )

        return CustomerCoverageSummary(
            customer_id=customer_id,
            window_days=window_days,
            n_outlets=len(outlets),
            n_with_log=counts["with_log"],
            n_with_legacy=counts["with_legacy"],
            n_missing_viable=counts["missing_viable"],
            n_missing_not_viable=counts["missing_not_viable"],
            outlets=per_outlet,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    async def _get_outlet(self, outlet_id: str) -> Outlet | None:
        result = await self.session.execute(
            select(Outlet).where(Outlet.id == outlet_id, Outlet.active.is_(True))
        )
        return result.scalar_one_or_none()

    async def _list_customer_outlets(self, customer_id: str) -> list[Outlet]:
        """Active outlets for a customer, scoped to the Production Outlet Group.

        The Configuration → Core tab's "Production Outlet Group" field maps to
        ``CustomerConfiguration.group_id`` (despite the column name; the
        adjacent ``production_group_id`` column is a separate, currently-unused
        concept). Elasticity analytics are restricted to outlets in that group
        so the page reflects the same set of outlets the customer treats as
        their production cohort. When no group is configured, falls back to
        all active outlets so the page remains usable for not-yet-configured
        customers.
        """
        production_group_id = await self.session.scalar(
            select(CustomerConfiguration.group_id).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        stmt = select(Outlet).where(
            Outlet.customer_id == customer_id,
            Outlet.active.is_(True),
        )
        if production_group_id is not None:
            stmt = stmt.join(
                OutletGroupMember, OutletGroupMember.outlet_id == Outlet.id
            ).where(
                OutletGroupMember.group_id == production_group_id,
                OutletGroupMember.active.is_(True),
            )
        stmt = stmt.order_by(Outlet.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def _load_beta_price(self, outlet_id: str) -> dict | None:
        """Load the persisted Ridge price coefficient for one outlet.

        Prefers ``log_price_per_unit`` (current covariate form) and falls back
        to the legacy ``price_per_unit`` when only that exists. Tags the
        return dict with ``form="log"|"level"`` so the elasticity conversion
        downstream picks the correct formula.
        """
        result = await self.session.execute(
            select(
                Covariate.name,
                CovariateOutlet.coefficient,
                CovariateOutlet.computed_at,
            )
            .join(Covariate, Covariate.id == CovariateOutlet.covariate_id)
            .where(
                Covariate.name.in_(
                    [LOG_PRICE_COVARIATE_NAME, LEVEL_PRICE_COVARIATE_NAME]
                ),
                CovariateOutlet.outlet_id == outlet_id,
                CovariateOutlet.active.is_(True),
            )
            .order_by(CovariateOutlet.computed_at.desc())
        )
        rows = result.all()
        if not rows:
            return None
        # Prefer log form when both exist for the same outlet.
        log_row = next((r for r in rows if r.name == LOG_PRICE_COVARIATE_NAME), None)
        level_row = next((r for r in rows if r.name == LEVEL_PRICE_COVARIATE_NAME), None)
        chosen = log_row or level_row
        return {
            "coefficient": float(chosen.coefficient),
            "computed_at": chosen.computed_at,
            "form": "log" if chosen is log_row else "level",
        }

    async def _load_beta_price_bulk(self, outlet_ids: list[str]) -> dict[str, dict]:
        """Bulk version of ``_load_beta_price`` — preferring log form per outlet."""
        if not outlet_ids:
            return {}
        result = await self.session.execute(
            select(
                CovariateOutlet.outlet_id,
                Covariate.name,
                CovariateOutlet.coefficient,
                CovariateOutlet.computed_at,
            )
            .join(Covariate, Covariate.id == CovariateOutlet.covariate_id)
            .where(
                Covariate.name.in_(
                    [LOG_PRICE_COVARIATE_NAME, LEVEL_PRICE_COVARIATE_NAME]
                ),
                CovariateOutlet.outlet_id.in_(outlet_ids),
                CovariateOutlet.active.is_(True),
            )
        )
        # _persist_covariate_outlets deletes prior rows before inserting, so
        # there is at most one row per (outlet, covariate name) pair. An
        # outlet can still hold one row of each name across separate runs;
        # we prefer log when both are present.
        by_outlet: dict[str, dict[str, tuple[float, object]]] = {}
        for row in result.all():
            by_outlet.setdefault(row.outlet_id, {})[row.name] = (
                float(row.coefficient),
                row.computed_at,
            )
        out: dict[str, dict] = {}
        for oid, names in by_outlet.items():
            if LOG_PRICE_COVARIATE_NAME in names:
                coeff, ts = names[LOG_PRICE_COVARIATE_NAME]
                out[oid] = {"coefficient": coeff, "computed_at": ts, "form": "log"}
            elif LEVEL_PRICE_COVARIATE_NAME in names:
                coeff, ts = names[LEVEL_PRICE_COVARIATE_NAME]
                out[oid] = {"coefficient": coeff, "computed_at": ts, "form": "level"}
        return out

    async def _deep_price_summary(
        self, customer_id: str
    ) -> tuple[date | None, int]:
        """Customer-wide deepest price-change scan from ``price_history``.

        Independent of ``window_days``. Surfaces price changes that fell
        outside the analysis window — useful for explaining why an outlet
        is flagged ``insufficient`` when its price actually moved years
        ago. Cheap: ``price_history`` is per-customer with at most a few
        hundred rows.

        Returns ``(last_change_date, n_distinct_prices)``. ``last_change_date``
        is the most recent ``effective_date`` where the price differs from
        the previous row in the same weekday partition. ``None`` if the
        customer's ladder has never actually changed.
        """
        distinct_result = await self.session.execute(
            select(func.count(func.distinct(PriceHistory.price_per_unit))).where(
                PriceHistory.customer_id == customer_id,
                PriceHistory.active.is_(True),
                PriceHistory.price_per_unit.is_not(None),
            )
        )
        n_distinct = int(distinct_result.scalar() or 0)

        prev = func.lag(PriceHistory.price_per_unit).over(
            partition_by=PriceHistory.weekday,
            order_by=PriceHistory.effective_date,
        ).label("prev")
        ordered = (
            select(
                PriceHistory.effective_date.label("effective_date"),
                PriceHistory.price_per_unit.label("price"),
                prev,
            )
            .where(
                PriceHistory.customer_id == customer_id,
                PriceHistory.active.is_(True),
                PriceHistory.price_per_unit.is_not(None),
            )
            .subquery()
        )
        last_change_result = await self.session.execute(
            select(func.max(ordered.c.effective_date)).where(
                ordered.c.prev.is_not(None),
                ordered.c.prev != ordered.c.price,
            )
        )
        last_change = last_change_result.scalar()
        return last_change, n_distinct

    async def _latest_sale_date(self, outlet_id: str) -> date | None:
        result = await self.session.execute(
            select(func.max(Sales.date)).where(
                Sales.outlet_id == outlet_id, Sales.active.is_(True)
            )
        )
        return result.scalar_one_or_none()

    async def _latest_sale_dates_bulk(
        self, outlet_ids: list[str]
    ) -> dict[str, date]:
        """Latest sale date per outlet in one GROUP BY query."""
        if not outlet_ids:
            return {}
        result = await self.session.execute(
            select(Sales.outlet_id, func.max(Sales.date))
            .where(Sales.outlet_id.in_(outlet_ids), Sales.active.is_(True))
            .group_by(Sales.outlet_id)
        )
        return {row[0]: row[1] for row in result.all() if row[1] is not None}

    async def _count_sale_days(
        self, outlet_id: str, start_date: date, end_date: date
    ) -> int:
        """Number of sale-rows for one outlet in the window."""
        result = await self.session.execute(
            select(func.count(Sales.sold)).where(
                Sales.outlet_id == outlet_id,
                Sales.active.is_(True),
                Sales.date >= start_date,
                Sales.date <= end_date,
                Sales.sold.is_not(None),
            )
        )
        return int(result.scalar_one() or 0)

    async def _count_sale_days_bulk(
        self, per_outlet_window: dict[str, tuple[date, date]]
    ) -> dict[str, int]:
        if not per_outlet_window:
            return {}
        outlet_ids = list(per_outlet_window.keys())
        min_start = min(w[0] for w in per_outlet_window.values())
        max_end = max(w[1] for w in per_outlet_window.values())
        result = await self.session.execute(
            select(Sales.outlet_id, Sales.date).where(
                Sales.outlet_id.in_(outlet_ids),
                Sales.active.is_(True),
                Sales.date >= min_start,
                Sales.date <= max_end,
                Sales.sold.is_not(None),
            )
        )
        counts: dict[str, int] = {}
        for oid, d in result.all():
            window = per_outlet_window.get(oid)
            if window is None or d < window[0] or d > window[1]:
                continue
            counts[oid] = counts.get(oid, 0) + 1
        return counts

    async def _mean_demand(
        self, outlet_id: str, start_date: date, end_date: date
    ) -> tuple[float | None, int]:
        """Return (mean sold per day, days observed) over [start_date, end_date]."""
        result = await self.session.execute(
            select(
                func.avg(Sales.sold).label("avg_sold"),
                func.count(Sales.sold).label("n"),
            ).where(
                Sales.outlet_id == outlet_id,
                Sales.active.is_(True),
                Sales.date >= start_date,
                Sales.date <= end_date,
                Sales.sold.is_not(None),
            )
        )
        row = result.one()
        mean = float(row.avg_sold) if row.avg_sold is not None else None
        return mean, int(row.n or 0)

    async def _mean_demand_bulk(
        self, per_outlet_window: dict[str, tuple[date, date]]
    ) -> dict[str, tuple[float | None, int]]:
        """Bulk per-outlet mean demand over each outlet's own window.

        A single query spans all outlets with the widest encompassing window;
        we then bucket rows per outlet in Python. Faster than N group-bys when
        outlets share overlapping ranges, which is typical.
        """
        if not per_outlet_window:
            return {}
        outlet_ids = list(per_outlet_window.keys())
        min_start = min(w[0] for w in per_outlet_window.values())
        max_end = max(w[1] for w in per_outlet_window.values())

        result = await self.session.execute(
            select(Sales.outlet_id, Sales.date, Sales.sold).where(
                Sales.outlet_id.in_(outlet_ids),
                Sales.active.is_(True),
                Sales.date >= min_start,
                Sales.date <= max_end,
                Sales.sold.is_not(None),
            )
        )
        sums: dict[str, float] = {}
        counts: dict[str, int] = {}
        for oid, d, sold in result.all():
            window = per_outlet_window.get(oid)
            if window is None:
                continue
            start_d, end_d = window
            if d < start_d or d > end_d:
                continue
            sums[oid] = sums.get(oid, 0.0) + float(sold)
            counts[oid] = counts.get(oid, 0) + 1
        out: dict[str, tuple[float | None, int]] = {}
        for oid in outlet_ids:
            n = counts.get(oid, 0)
            mean = sums[oid] / n if n > 0 else None
            out[oid] = (mean, n)
        return out

    async def _price_series(
        self, outlet_id: str, customer_id: str, start_date: date, end_date: date
    ) -> dict[date, float]:
        """Resolve the level price series over [start_date, end_date].

        Delegates to ``PredictionService._build_covariates`` so that the 5-tier
        fallback chain (FinancialDate → PriceHistory → OutletFinancials →
        CustomerConfiguration → Configuration) stays consistent with what the
        Ridge regression actually saw during training. The covariate now ships
        as ``log_price_per_unit``; we exponentiate it back to level prices for
        descriptive analytics (mean, CV, range).
        """
        # Local import avoids a circular dependency at module load time.
        from crypto_ai.services.prediction import PredictionService

        prediction_service = PredictionService(self.session)
        covariates = await prediction_service._build_covariates(
            outlet_id=outlet_id,
            customer_id=customer_id,
            start_date=start_date,
            end_date=end_date,
        )
        return _extract_level_prices(covariates)

    async def _pricing_series(
        self, outlet_id: str, customer_id: str, start_date: date, end_date: date
    ) -> tuple[dict[date, float], dict[date, float]]:
        """Resolve level price and cost series for one outlet."""
        from crypto_ai.services.prediction import PredictionService

        prediction_service = PredictionService(self.session)
        covariates = await prediction_service._build_covariates(
            outlet_id=outlet_id,
            customer_id=customer_id,
            start_date=start_date,
            end_date=end_date,
        )
        if covariates is None:
            return {}, {}
        return (
            _extract_level_prices(covariates),
            covariates.get("cost_per_unit", {}),
        )

    async def _pricing_series_bulk(
        self,
        *,
        outlet_ids: list[str],
        customer_id: str,
        start_date: date,
        end_date: date,
    ) -> tuple[dict[str, dict[date, float]], dict[str, dict[date, float]]]:
        """Bulk price and cost series across multiple outlets sharing one window."""
        if not outlet_ids:
            return {}, {}
        from crypto_ai.services.prediction import PredictionService

        prediction_service = PredictionService(self.session)
        covariates_by_outlet = await prediction_service._build_covariates_bulk(
            outlet_ids=outlet_ids,
            customer_id=customer_id,
            start_date=start_date,
            end_date=end_date,
        )
        price_out: dict[str, dict[date, float]] = {}
        cost_out: dict[str, dict[date, float]] = {}
        for oid, covariates in covariates_by_outlet.items():
            price_out[oid] = _extract_level_prices(covariates)
            cost_out[oid] = covariates.get("cost_per_unit", {}) if covariates else {}
        return price_out, cost_out

    async def _price_series_bulk(
        self,
        *,
        outlet_ids: list[str],
        customer_id: str,
        start_date: date,
        end_date: date,
    ) -> dict[str, dict[date, float]]:
        """Bulk price series across multiple outlets sharing one window."""
        if not outlet_ids:
            return {}
        from crypto_ai.services.prediction import PredictionService

        prediction_service = PredictionService(self.session)
        covariates_by_outlet = await prediction_service._build_covariates_bulk(
            outlet_ids=outlet_ids,
            customer_id=customer_id,
            start_date=start_date,
            end_date=end_date,
        )
        out: dict[str, dict[date, float]] = {}
        for oid, covariates in covariates_by_outlet.items():
            out[oid] = _extract_level_prices(covariates)
        return out

    def _classify_confidence(
        self,
        *,
        beta: dict | None,
        price_cv: float | None,
        within_weekday_cv: float | None,
        n_distinct: int,
        n_days: int,
        weekday_driven: bool = False,
    ) -> tuple[ElasticityConfidence, str | None]:
        if beta is None:
            return (
                "insufficient_data",
                "No Ridge coefficient — outlet has not been included in a "
                "prediction run that fit Ridge on residuals. Run any "
                "foundation-model engine over this outlet to populate one "
                "(Statistical and Custom engines do not fit Ridge).",
            )
        if n_days < MIN_DAYS_FOR_ELASTICITY:
            return (
                "insufficient_data",
                f"Only {n_days} days of sales in the window — need at least "
                f"{MIN_DAYS_FOR_ELASTICITY}.",
            )
        if price_cv is None or n_distinct < 2:
            return (
                "low",
                "Price has not varied in the window — the coefficient may be a "
                "regularisation artefact rather than a demand response.",
            )
        if weekday_driven:
            return (
                "low",
                "Price varies only by weekday (e.g. Mon–Sat vs Sun) and is "
                "constant within each weekday. The Ridge β is collinear with "
                "the day-of-week dummies, so the value is a regularisation "
                "artefact rather than a real price-response signal. Treat "
                "elasticity from this fit as unreliable.",
            )
        # Ridge identifies the price coefficient from within-weekday variation
        # only — day-of-week dummies absorb the between-weekday tier. Threshold
        # against ``within_weekday_cv`` rather than the overall CV so customers
        # whose only "variation" is a weekday tier do not get a misleading
        # "high" verdict.
        effective_cv = within_weekday_cv if within_weekday_cv is not None else price_cv
        if effective_cv >= ADEQUATE_PRICE_CV and n_days >= ADEQUATE_MIN_DAYS:
            return "high", None
        if effective_cv >= MARGINAL_PRICE_CV:
            return "medium", None
        return (
            "low",
            f"Within-weekday price CV is {effective_cv:.3f} — too small for a "
            "reliable elasticity estimate (Ridge identifies elasticity from "
            "within-weekday variation only; the day-of-week dummies absorb the "
            "between-weekday tier).",
        )

    def _classify_viability(
        self,
        *,
        price_cv: float | None,
        within_weekday_cv: float | None,
        n_distinct: int,
        n_days: int,
        weekday_driven: bool = False,
    ) -> tuple[PriceVariationViability, str | None]:
        if n_distinct < 2 or price_cv is None:
            return (
                "insufficient",
                "Price has not changed in the window — no signal for elasticity.",
            )
        if weekday_driven:
            return (
                "insufficient",
                "Price varies only by weekday (e.g. Mon–Sat vs Sun) and is "
                "constant within each weekday. Ridge cannot separate this "
                "from day-of-week effects, so the within-window data carries "
                "no usable price-response signal — even though the across-"
                "weekday CV looks adequate.",
            )
        # See _classify_confidence: viability is judged on within-weekday
        # variation, since that is what the Ridge price coefficient is
        # identified from.
        effective_cv = within_weekday_cv if within_weekday_cv is not None else price_cv
        if effective_cv >= ADEQUATE_PRICE_CV and n_days >= ADEQUATE_MIN_DAYS:
            return "adequate", None
        if effective_cv >= MARGINAL_PRICE_CV and n_days >= MIN_DAYS_FOR_ELASTICITY:
            return (
                "marginal",
                f"Within-weekday price variation (cv={effective_cv:.3f}) is "
                "small — estimates may be noisy. Consider widening the window "
                "or waiting for more price history.",
            )
        return (
            "insufficient",
            f"Within-weekday price variation (cv={effective_cv:.3f}, "
            f"{n_days} days observed) is too small to support elasticity "
            "analysis. The day-of-week dummies absorb between-weekday tiers, "
            "so only within-weekday movement counts.",
        )

    async def _build_result(
        self,
        outlet: Outlet,
        beta: dict | None,
        *,
        window_days: int,
    ) -> OutletElasticity:
        """Single-outlet result — fetches its own window data."""
        latest = await self._latest_sale_date(outlet.id)
        end_date = latest or date.today()
        start_date = end_date - timedelta(days=window_days - 1)

        price_map = await self._price_series(
            outlet_id=outlet.id,
            customer_id=outlet.customer_id,
            start_date=start_date,
            end_date=end_date,
        )
        mean_demand, n_days = await self._mean_demand(
            outlet.id, start_date=start_date, end_date=end_date
        )
        return self._assemble_result(
            outlet=outlet,
            beta=beta,
            price_map=price_map,
            mean_demand=mean_demand,
            n_days=n_days,
            window_days=window_days,
        )

    def _assemble_scenario(
        self,
        *,
        outlet: Outlet,
        elasticity: OutletElasticity,
        mean_cost: float | None,
        price_values: list[float],
        adjustment_pcts: list[float],
        window_days: int,
        projection: ProjectionMode = "constant_elasticity",
    ) -> OutletPriceScenario:
        """Project scenario outcomes from a pre-computed elasticity and cost."""
        q0 = elasticity.mean_demand
        p0 = elasticity.mean_price
        eps = elasticity.elasticity

        clean = [v for v in price_values if v is not None]
        min_p = float(np.min(clean)) if clean else None
        max_p = float(np.max(clean)) if clean else None

        baseline_rev: float | None = None
        baseline_profit: float | None = None
        if q0 is not None and p0 is not None:
            baseline_rev = q0 * p0
            if mean_cost is not None:
                baseline_profit = q0 * (p0 - mean_cost)

        scenarios: list[OutletScenarioOutcome] = []
        reason: str | None = None
        if eps is None or q0 is None or p0 is None:
            reason = elasticity.reason or "No elasticity estimate available for this outlet."
            for delta in adjustment_pcts:
                scenarios.append(OutletScenarioOutcome(adjustment_pct=delta))
        else:
            for delta in adjustment_pcts:
                p1 = p0 * (1 + delta)
                if projection == "constant_elasticity":
                    # Standard economic form: q₁ = q₀ × (1 + Δ)^ε.
                    # (1+Δ) is always positive for Δ > -1, which our validator
                    # enforces (|Δ| ≤ 0.5), so the power is well-defined.
                    q1 = q0 * (1 + delta) ** eps
                else:
                    # Local linear projection, clamped to non-negative.
                    q1 = max(0.0, q0 * (1 + eps * delta))
                rev1 = q1 * p1
                profit1 = q1 * (p1 - mean_cost) if mean_cost is not None else None

                # Extrapolation: new price more than 5% outside historical range.
                extrap = False
                if min_p is not None and max_p is not None:
                    if p1 < min_p * 0.95 or p1 > max_p * 1.05:
                        extrap = True

                demand_delta_pct = (
                    (q1 - q0) / q0 * 100 if q0 > 0 else None
                )
                rev_delta_pct = (
                    (rev1 - baseline_rev) / baseline_rev * 100
                    if baseline_rev and baseline_rev > 0
                    else None
                )
                profit_delta_pct: float | None = None
                if profit1 is not None and baseline_profit not in (None, 0):
                    profit_delta_pct = (
                        (profit1 - baseline_profit) / abs(baseline_profit) * 100
                    )

                scenarios.append(
                    OutletScenarioOutcome(
                        adjustment_pct=delta,
                        new_price=p1,
                        scenario_daily_demand=q1,
                        scenario_daily_revenue=rev1,
                        scenario_daily_profit=profit1,
                        demand_delta_pct=demand_delta_pct,
                        revenue_delta_pct=rev_delta_pct,
                        profit_delta_pct=profit_delta_pct,
                        extrapolation=extrap,
                    )
                )

        return OutletPriceScenario(
            outlet_id=outlet.id,
            outlet_name=_outlet_display_name(outlet),
            window_days=window_days,
            projection=projection,
            elasticity=eps,
            confidence=elasticity.confidence,
            mean_price=p0,
            mean_demand=q0,
            mean_cost=mean_cost,
            baseline_daily_revenue=baseline_rev,
            baseline_daily_profit=baseline_profit,
            min_observed_price=min_p,
            max_observed_price=max_p,
            scenarios=scenarios,
            reason=reason,
        )

    def _assemble_recommendation(
        self,
        *,
        outlet: Outlet,
        elasticity: OutletElasticity,
        mean_cost: float | None,
        price_values: list[float],
        window_days: int,
    ) -> OutletPriceRecommendation:
        """Find the profit-maximising adjustment within the outlet's safe range.

        Always uses constant-elasticity projection. Sweep step matches
        ``RECOMMENDATION_SWEEP_STEP``; bounds are clipped to the outlet's
        safe range derived from observed prices.
        """
        eps = elasticity.elasticity
        q0 = elasticity.mean_demand
        p0 = elasticity.mean_price
        confidence = elasticity.confidence

        # Build a base record we'll fill in as we go.
        base = OutletPriceRecommendation(
            outlet_id=outlet.id,
            outlet_name=_outlet_display_name(outlet),
            window_days=window_days,
            elasticity=eps,
            confidence=confidence,
            mean_price=p0,
            mean_cost=mean_cost,
        )

        if confidence not in RECOMMENDATION_MIN_CONFIDENCE:
            base.reason = (
                "Elasticity confidence is below the medium threshold; the "
                "profit curve is too uncertain to recommend an action."
            )
            return base
        if eps is None or q0 is None or p0 is None or q0 <= 0 or p0 <= 0:
            base.reason = (
                "Missing elasticity, mean price, or mean demand — cannot "
                "compute a recommendation."
            )
            return base
        if mean_cost is None:
            base.reason = (
                "No cost data for this outlet; profit cannot be projected. "
                "Configure cost_per_unit to enable recommendations."
            )
            return base

        # Safe range from historical prices, mirrored at ±5% to match
        # the scenario extrapolation flag.
        clean = [v for v in price_values if v is not None and v > 0]
        if not clean:
            base.reason = "No observed prices in the window."
            return base
        min_p = float(np.min(clean))
        max_p = float(np.max(clean))
        safe_min = max(RECOMMENDATION_BOUND_MIN, (min_p * 0.95) / p0 - 1)
        safe_max = min(RECOMMENDATION_BOUND_MAX, (max_p * 1.05) / p0 - 1)
        # Always include zero so the baseline is part of the sweep.
        safe_min = min(safe_min, 0.0)
        safe_max = max(safe_max, 0.0)
        base.safe_range_min_adjustment = safe_min
        base.safe_range_max_adjustment = safe_max

        baseline_profit = q0 * (p0 - mean_cost)
        base.baseline_daily_profit = baseline_profit

        # Sweep.
        best_delta = 0.0
        best_profit = baseline_profit
        delta = safe_min
        while delta <= safe_max + RECOMMENDATION_SWEEP_STEP / 2:
            p1 = p0 * (1 + delta)
            q1 = q0 * (1 + delta) ** eps
            profit1 = q1 * (p1 - mean_cost)
            if profit1 > best_profit:
                best_profit = profit1
                best_delta = delta
            delta += RECOMMENDATION_SWEEP_STEP

        rec_price = p0 * (1 + best_delta)
        uplift_pct: float | None = None
        if abs(baseline_profit) > 1e-9:
            uplift_pct = (best_profit - baseline_profit) / abs(baseline_profit) * 100

        boundary_eps = RECOMMENDATION_SWEEP_STEP / 2
        if abs(best_delta) < boundary_eps:
            base.status = "no_change"
            base.reason = "Profit is highest near the current price."
        elif best_delta >= safe_max - boundary_eps:
            base.status = "boundary_high"
            base.reason = (
                f"Profit keeps rising up to the safe ceiling "
                f"(Δ={best_delta * 100:.1f}%). Likely underpriced — widen the "
                "historical range with smaller controlled raises before pushing "
                "further."
            )
        elif best_delta <= safe_min + boundary_eps:
            base.status = "boundary_low"
            base.reason = (
                f"Profit is highest at the safe floor (Δ={best_delta * 100:.1f}%). "
                "Unusual — check the elasticity sign."
            )
        else:
            base.status = "recommended"

        base.recommended_adjustment_pct = best_delta
        base.recommended_price = rec_price
        base.projected_daily_profit = best_profit
        base.profit_uplift_pct = uplift_pct
        return base

    def _assemble_variation(
        self,
        *,
        outlet: Outlet,
        price_map: dict[date, float],
        n_days: int,
        window_days: int,
    ) -> OutletPriceVariation:
        """Pure assembly of variation stats from a pre-fetched price map."""
        items = sorted(price_map.items())
        prices = [v for _, v in items if v is not None]
        mean_price = float(np.mean(prices)) if prices else None
        min_p = float(np.min(prices)) if prices else None
        max_p = float(np.max(prices)) if prices else None
        n_distinct = len({round(v, 6) for v in prices})
        price_cv: float | None = None
        if mean_price and mean_price > 0 and len(prices) >= 2:
            price_cv = float(np.std(prices, ddof=0) / mean_price)

        first_change: date | None = None
        last_change: date | None = None
        for (d_prev, v_prev), (d_next, v_next) in zip(items, items[1:]):
            if v_prev is None or v_next is None:
                continue
            if round(v_prev, 6) != round(v_next, 6):
                if first_change is None:
                    first_change = d_next
                last_change = d_next

        weekday_driven = _is_weekday_driven_price(price_map)
        within_weekday_cv = _within_weekday_cv(price_map)
        viability, reason = self._classify_viability(
            price_cv=price_cv,
            within_weekday_cv=within_weekday_cv,
            n_distinct=n_distinct,
            n_days=n_days,
            weekday_driven=weekday_driven,
        )

        return OutletPriceVariation(
            outlet_id=outlet.id,
            outlet_name=_outlet_display_name(outlet),
            window_days=window_days,
            n_days_observed=n_days,
            n_distinct_prices=n_distinct,
            min_price=min_p,
            max_price=max_p,
            mean_price=mean_price,
            price_cv=price_cv,
            within_weekday_cv=within_weekday_cv,
            first_change_date=first_change,
            last_change_date=last_change,
            viability=viability,
            reason=reason,
        )

    def _assemble_result(
        self,
        *,
        outlet: Outlet,
        beta: dict | None,
        price_map: dict[date, float],
        mean_demand: float | None,
        n_days: int,
        window_days: int,
    ) -> OutletElasticity:
        """Pure assembly from pre-fetched data — no DB access."""
        price_values = [v for v in price_map.values() if v is not None]
        mean_price = float(np.mean(price_values)) if price_values else None
        price_cv: float | None = None
        n_distinct = len({round(v, 6) for v in price_values})
        if mean_price and mean_price > 0 and len(price_values) >= 2:
            price_cv = float(np.std(price_values, ddof=0) / mean_price)

        weekday_driven = _is_weekday_driven_price(price_map)
        within_weekday_cv = _within_weekday_cv(price_map)
        confidence, reason = self._classify_confidence(
            beta=beta,
            price_cv=price_cv,
            within_weekday_cv=within_weekday_cv,
            n_distinct=n_distinct,
            n_days=n_days,
            weekday_driven=weekday_driven,
        )

        elasticity: float | None = None
        beta_price: float | None = None
        computed_at = None
        if beta is not None:
            beta_price = beta["coefficient"]
            computed_at = beta["computed_at"]
            if (
                mean_demand is not None
                and mean_demand > 0
                and confidence != "insufficient_data"
            ):
                if beta.get("form") == "log":
                    # log-price Ridge: β is the semi-elasticity (∂q/∂log p),
                    # so ε = β / q̄ — independent of mean price.
                    elasticity = beta_price / mean_demand
                elif mean_price is not None:
                    # Legacy level-price Ridge: ε = β × p̄/q̄.
                    elasticity = beta_price * (mean_price / mean_demand)

        return OutletElasticity(
            outlet_id=outlet.id,
            outlet_name=_outlet_display_name(outlet),
            beta_price=beta_price,
            elasticity=elasticity,
            mean_price=mean_price,
            mean_demand=mean_demand,
            price_cv=price_cv,
            within_weekday_cv=within_weekday_cv,
            n_distinct_prices=n_distinct,
            n_days_observed=n_days,
            window_days=window_days,
            confidence=confidence,
            reason=reason,
            computed_at=computed_at,
        )
