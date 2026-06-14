"""Elasticity analytics Pydantic schemas."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

ElasticityConfidence = Literal["high", "medium", "low", "insufficient_data"]
PriceVariationViability = Literal["adequate", "marginal", "insufficient"]
ProjectionMode = Literal["constant_elasticity", "linear"]
RecommendationStatus = Literal[
    "recommended",       # interior optimum found within safe range
    "boundary_high",     # profit still rising at the upper safety cap
    "boundary_low",      # profit still rising as price drops (rare; wrong-sign β)
    "no_change",         # baseline already optimal (or near it)
    "insufficient_data", # no usable elasticity / cost / sample
]
CoverageState = Literal[
    "with_log",          # log-form Ridge coefficient persisted
    "with_legacy",       # legacy level-form Ridge coefficient persisted
    "missing_viable",    # no coefficient yet, but price variation is at least marginal
    "missing_not_viable",# no coefficient and price variation is insufficient — backfill won't help
]
RidgeCapableEngine = Literal[
    "flowstate",
    "yinglong",
    "toto",
    "moirai2",
    "timesfm",
    "timesfm_finetuned",
    "chronos2",
    "chronos-bolt",
    "sundial",
    "kairos",
    "tirex",
    "gluon-chronos-bolt",
    "gluon-chronos2",
    "gluon-toto",
]


class OutletElasticity(BaseModel):
    """Own-price elasticity estimate for a single outlet.

    Derived from the most recently persisted Ridge coefficient on the
    ``price_per_unit`` covariate for this outlet. Elasticity is the
    dimensionless form: ``beta_price * (mean_price / mean_demand)``.

    ``price_cv`` is the overall coefficient of variation. ``within_weekday_cv``
    demeans price by weekday before computing CV — this is the variation the
    Ridge fit actually identifies elasticity from, since day-of-week dummies
    absorb the between-weekday tier. Confidence thresholds are evaluated
    against ``within_weekday_cv``.
    """

    outlet_id: str
    outlet_name: str | None = None
    beta_price: float | None = None
    elasticity: float | None = None
    mean_price: float | None = None
    mean_demand: float | None = None
    price_cv: float | None = None
    within_weekday_cv: float | None = None
    n_distinct_prices: int = 0
    n_days_observed: int = 0
    window_days: int
    confidence: ElasticityConfidence = "insufficient_data"
    reason: str | None = None
    computed_at: datetime | None = None


class CustomerElasticitySummary(BaseModel):
    """Aggregated elasticity across all active outlets for a customer."""

    customer_id: str
    window_days: int
    n_outlets: int
    n_outlets_with_elasticity: int
    median_elasticity: float | None = None
    p10_elasticity: float | None = None
    p90_elasticity: float | None = None
    outlets: list[OutletElasticity]


class OutletPriceVariation(BaseModel):
    """Whether an outlet has enough price movement to support elasticity analysis.

    Pure data-viability check — does not depend on any persisted Ridge output,
    so it can be run against a fresh customer before any forecast is produced.

    ``price_cv`` is the overall coefficient of variation across all observed
    prices. ``within_weekday_cv`` demeans by weekday first — this is the
    variation that drives the Ridge price coefficient (day-of-week dummies
    absorb the between-weekday tier). Viability is graded against
    ``within_weekday_cv``.
    """

    outlet_id: str
    outlet_name: str | None = None
    window_days: int
    n_days_observed: int
    n_distinct_prices: int
    min_price: float | None = None
    max_price: float | None = None
    mean_price: float | None = None
    price_cv: float | None = None
    within_weekday_cv: float | None = None
    first_change_date: date | None = None
    last_change_date: date | None = None
    viability: PriceVariationViability = "insufficient"
    reason: str | None = None


class CustomerPriceVariation(BaseModel):
    """Aggregated price-variation viability across all active outlets for a customer.

    The ``deep_*`` fields summarise customer-wide price movement across
    *all* of ``price_history``, independent of ``window_days``. Useful for
    diagnosing the case where outlets show as ``insufficient`` because the
    only meaningful price change happened years ago, outside any selectable
    analysis window.
    """

    customer_id: str
    window_days: int
    n_outlets: int
    n_adequate: int
    n_marginal: int
    n_insufficient: int
    overall_viability: PriceVariationViability
    outlets: list[OutletPriceVariation]
    deep_last_change_date: date | None = None
    deep_n_distinct_prices: int = 0


class OutletScenarioOutcome(BaseModel):
    """Impact of one price adjustment on a single outlet.

    Projected from the outlet's own-price elasticity. Two projection modes
    are supported:

    - ``constant_elasticity`` (default): ``q₁ = q₀ × (1 + Δ)^ε``. Standard
      economic form; well-behaved at larger adjustments.
    - ``linear``: ``q₁ = q₀ × (1 + ε × Δ)``. Local linear approximation;
      matches ``constant_elasticity`` for small Δ but drifts at extremes.

    In both cases ``extrapolation`` flags when the new price lies more than
    5% outside the outlet's historically observed range.
    """

    adjustment_pct: float
    new_price: float | None = None
    scenario_daily_demand: float | None = None
    scenario_daily_revenue: float | None = None
    scenario_daily_profit: float | None = None
    demand_delta_pct: float | None = None
    revenue_delta_pct: float | None = None
    profit_delta_pct: float | None = None
    extrapolation: bool = False


class OutletPriceScenario(BaseModel):
    """Per-outlet scenario analysis plus the inputs it was projected from."""

    outlet_id: str
    outlet_name: str | None = None
    window_days: int
    projection: ProjectionMode = "constant_elasticity"
    elasticity: float | None = None
    confidence: ElasticityConfidence = "insufficient_data"
    mean_price: float | None = None
    mean_demand: float | None = None
    mean_cost: float | None = None
    baseline_daily_revenue: float | None = None
    baseline_daily_profit: float | None = None
    min_observed_price: float | None = None
    max_observed_price: float | None = None
    scenarios: list[OutletScenarioOutcome] = []
    reason: str | None = None


class CustomerScenarioOutcome(BaseModel):
    """Customer-level aggregate for one price adjustment.

    Sums outlet-level projections across every outlet with usable elasticity.
    Outlets lacking an elasticity estimate are excluded from both the
    baseline and the scenario totals so the deltas compare like with like.
    """

    adjustment_pct: float
    scenario_daily_demand: float
    scenario_daily_revenue: float
    scenario_daily_profit: float | None = None
    demand_delta_pct: float
    revenue_delta_pct: float
    profit_delta_pct: float | None = None
    n_outlets_included: int


class CustomerPriceScenario(BaseModel):
    """Customer-wide price scenario — one or more adjustments at once."""

    customer_id: str
    window_days: int
    projection: ProjectionMode = "constant_elasticity"
    adjustment_pcts: list[float]
    n_outlets: int
    n_outlets_included: int
    n_outlets_excluded: int
    baseline_daily_demand: float
    baseline_daily_revenue: float
    baseline_daily_profit: float | None = None
    scenarios: list[CustomerScenarioOutcome]
    outlets: list[OutletPriceScenario] | None = None


class OutletPriceRecommendation(BaseModel):
    """Per-outlet profit-maximising price recommendation.

    Found via fine sweep over Δ within the outlet's safe range (5% padding
    outside historically observed prices). Computed under the
    ``constant_elasticity`` projection. Outlets without a usable elasticity,
    cost, or confidence at least ``medium`` return ``status="insufficient_data"``.
    """

    outlet_id: str
    outlet_name: str | None = None
    window_days: int
    status: RecommendationStatus = "insufficient_data"
    elasticity: float | None = None
    confidence: ElasticityConfidence = "insufficient_data"
    mean_price: float | None = None
    mean_cost: float | None = None
    recommended_adjustment_pct: float | None = None
    recommended_price: float | None = None
    baseline_daily_profit: float | None = None
    projected_daily_profit: float | None = None
    profit_uplift_pct: float | None = None
    safe_range_min_adjustment: float | None = None
    safe_range_max_adjustment: float | None = None
    reason: str | None = None


class CustomerPriceRecommendation(BaseModel):
    """Single-knob customer-wide price recommendation.

    Sweeps a uniform Δ applied to all included outlets and picks the value
    that maximises aggregate projected profit, capped to the
    *most-restrictive* extrapolation bound across outlets so no individual
    outlet is pushed outside its historical price range. ``outlets`` carries
    each outlet's own optimum when ``include_outlets=True``.
    """

    customer_id: str
    window_days: int
    status: RecommendationStatus = "insufficient_data"
    n_outlets: int
    n_outlets_included: int
    n_outlets_excluded: int
    baseline_daily_revenue: float = 0.0
    baseline_daily_profit: float | None = None
    recommended_adjustment_pct: float | None = None
    projected_daily_revenue: float | None = None
    projected_daily_profit: float | None = None
    profit_uplift_pct: float | None = None
    safe_range_min_adjustment: float | None = None
    safe_range_max_adjustment: float | None = None
    reason: str | None = None
    outlets: list[OutletPriceRecommendation] | None = None


class OutletCoverage(BaseModel):
    """Per-outlet Ridge-coefficient coverage state.

    Combines the coefficient lookup with the variation viability check so the
    UI can distinguish "outlet has no coefficient because nothing has been
    run yet" from "outlet has no coefficient and won't get a useful one
    because its price never moves".
    """

    outlet_id: str
    outlet_name: str | None = None
    state: CoverageState
    viability: PriceVariationViability
    n_days_observed: int
    price_cv: float | None = None
    within_weekday_cv: float | None = None
    computed_at: datetime | None = None


class CustomerCoverageSummary(BaseModel):
    """Customer-wide elasticity coverage with backfill targets identified."""

    customer_id: str
    window_days: int
    n_outlets: int
    n_with_log: int
    n_with_legacy: int
    n_missing_viable: int
    n_missing_not_viable: int
    outlets: list[OutletCoverage]


class CoverageBackfillRequest(BaseModel):
    """Parameters for an elasticity-coefficient backfill run.

    Backfill dispatches a normal prediction over the missing-but-viable
    outlets using a Ridge-capable engine; the prediction job's residual fit
    populates ``covariate_outlet`` for those outlets. ``prediction_days``
    only governs the forward window — the historical window driving Ridge
    fit is fixed by the engine's training logic.
    """

    engine: RidgeCapableEngine = "flowstate"
    prediction_days: int = Field(default=7, ge=1, le=60)
    window_days: int = Field(default=90, ge=14, le=730)
    batch_size: int = Field(default=32, ge=1, le=512)
    worker: str | None = None


class CoverageBackfillResponse(BaseModel):
    """Result of a backfill dispatch."""

    customer_id: str
    task_id: str | None = None
    n_outlets_dispatched: int
    engine: str
    message: str
