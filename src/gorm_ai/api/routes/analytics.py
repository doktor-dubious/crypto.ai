"""Analytics API routes — derived insights from forecast outputs.

Most endpoints are read-only over data already produced by the forecast
pipeline. The single exception is ``POST /elasticity/backfill/customer/{id}``,
which dispatches a normal prediction over outlets that don't yet have a
Ridge coefficient — same code path as ``POST /predictions/async``, just
scoped to a coverage-derived outlet list.
"""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Body, HTTPException, Query

from gorm_ai.api.deps import ElasticityServiceDep, TaskServiceDep
from gorm_ai.schemas.elasticity import (
    CoverageBackfillRequest,
    CoverageBackfillResponse,
    CustomerCoverageSummary,
    CustomerElasticitySummary,
    CustomerPriceRecommendation,
    CustomerPriceScenario,
    CustomerPriceVariation,
    OutletElasticity,
    OutletPriceRecommendation,
    OutletPriceScenario,
    OutletPriceVariation,
)
from gorm_ai.schemas.prediction import PredictionEngine, PredictionRequest
from gorm_ai.tasks.predictions import run_prediction_task

ProjectionQuery = Literal["constant_elasticity", "linear"]

router = APIRouter()


@router.get("/elasticity/outlet/{outlet_id}", response_model=OutletElasticity)
async def get_outlet_elasticity(
    outlet_id: str,
    service: ElasticityServiceDep,
    window_days: int = Query(90, ge=14, le=730),
) -> OutletElasticity:
    """Own-price elasticity estimate for a single outlet.

    Derived from the most recently persisted Ridge coefficient on
    ``price_per_unit`` (or ``log_price_per_unit``) for this outlet. Any
    foundation-model engine that fit Ridge on residuals — i.e. any engine
    other than Statistical or Custom, run with ``covariate_handling`` other
    than ``"none"`` — will populate one.
    """
    result = await service.get_outlet_elasticity(outlet_id, window_days=window_days)
    if result is None:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return result


@router.get(
    "/elasticity/customer/{customer_id}", response_model=CustomerElasticitySummary
)
async def get_customer_elasticity(
    customer_id: str,
    service: ElasticityServiceDep,
    window_days: int = Query(90, ge=14, le=730),
) -> CustomerElasticitySummary:
    """Aggregated own-price elasticity across all active outlets for a customer."""
    return await service.get_customer_elasticity(customer_id, window_days=window_days)


@router.get(
    "/pricing/viability/outlet/{outlet_id}", response_model=OutletPriceVariation
)
async def get_outlet_price_viability(
    outlet_id: str,
    service: ElasticityServiceDep,
    window_days: int = Query(90, ge=14, le=730),
) -> OutletPriceVariation:
    """Does this outlet have enough price movement to support elasticity analysis?

    Independent of any persisted Ridge output — useful as an onboarding check
    before running predictions for a new customer.
    """
    result = await service.check_outlet_variation(outlet_id, window_days=window_days)
    if result is None:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return result


@router.get(
    "/pricing/viability/customer/{customer_id}", response_model=CustomerPriceVariation
)
async def get_customer_price_viability(
    customer_id: str,
    service: ElasticityServiceDep,
    window_days: int = Query(90, ge=14, le=730),
) -> CustomerPriceVariation:
    """Aggregated price-variation viability for all active outlets of a customer."""
    return await service.check_customer_variation(customer_id, window_days=window_days)


@router.get(
    "/pricing/scenario/outlet/{outlet_id}", response_model=OutletPriceScenario
)
async def get_outlet_price_scenario(
    outlet_id: str,
    service: ElasticityServiceDep,
    adjustment_pcts: list[float] = Query(
        default=[-0.1, -0.05, 0.0, 0.05, 0.1],
        description="One or more price adjustments as decimals "
        "(0.05 = +5%). Valid range: -0.5 to 0.5.",
    ),
    window_days: int = Query(90, ge=14, le=730),
    projection: ProjectionQuery = Query(
        "constant_elasticity",
        description="Projection form. 'constant_elasticity' uses "
        "q₁ = q₀ × (1+Δ)^ε (default, preferred at larger Δ). 'linear' uses "
        "q₁ = q₀ × (1 + ε × Δ) (first-order approximation).",
    ),
) -> OutletPriceScenario:
    """Project demand / revenue / profit impact of price changes for one outlet.

    Each adjustment emits a scenario outcome; the ``extrapolation`` flag
    indicates when the new price lies outside the historically observed range.
    """
    _validate_adjustments(adjustment_pcts)
    result = await service.compute_outlet_scenario(
        outlet_id,
        adjustment_pcts=adjustment_pcts,
        window_days=window_days,
        projection=projection,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return result


@router.get(
    "/pricing/scenario/customer/{customer_id}", response_model=CustomerPriceScenario
)
async def get_customer_price_scenario(
    customer_id: str,
    service: ElasticityServiceDep,
    adjustment_pcts: list[float] = Query(
        default=[-0.1, -0.05, 0.0, 0.05, 0.1],
        description="One or more price adjustments as decimals "
        "(0.05 = +5%). Valid range: -0.5 to 0.5.",
    ),
    window_days: int = Query(90, ge=14, le=730),
    include_outlets: bool = Query(
        False,
        description="Include per-outlet detail in the response. Omit for "
        "customers with many outlets.",
    ),
    projection: ProjectionQuery = Query(
        "constant_elasticity",
        description="Projection form. 'constant_elasticity' uses "
        "q₁ = q₀ × (1+Δ)^ε (default, preferred at larger Δ). 'linear' uses "
        "q₁ = q₀ × (1 + ε × Δ) (first-order approximation).",
    ),
) -> CustomerPriceScenario:
    """Project aggregated customer-wide impact of price changes.

    Only outlets with a usable elasticity estimate contribute to the totals.
    Outlets without one are counted under ``n_outlets_excluded`` and — when
    ``include_outlets=true`` — returned in the per-outlet list with a
    ``reason`` explaining why no scenario was computed.
    """
    _validate_adjustments(adjustment_pcts)
    return await service.compute_customer_scenario(
        customer_id,
        adjustment_pcts=adjustment_pcts,
        window_days=window_days,
        include_outlets=include_outlets,
        projection=projection,
    )


@router.get(
    "/pricing/recommendation/outlet/{outlet_id}",
    response_model=OutletPriceRecommendation,
)
async def get_outlet_price_recommendation(
    outlet_id: str,
    service: ElasticityServiceDep,
    window_days: int = Query(90, ge=14, le=730),
) -> OutletPriceRecommendation:
    """Profit-maximising price recommendation for one outlet.

    Sweeps adjustments within the outlet's safe range and returns the argmax
    under the constant-elasticity projection. ``status`` indicates whether a
    usable optimum was found (``recommended``), the sweep hit a boundary
    (``boundary_high`` / ``boundary_low``), the baseline is already optimal
    (``no_change``), or inputs are missing (``insufficient_data``).
    """
    result = await service.recommend_outlet_price(outlet_id, window_days=window_days)
    if result is None:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return result


@router.get(
    "/pricing/recommendation/customer/{customer_id}",
    response_model=CustomerPriceRecommendation,
)
async def get_customer_price_recommendation(
    customer_id: str,
    service: ElasticityServiceDep,
    window_days: int = Query(90, ge=14, le=730),
    include_outlets: bool = Query(
        False,
        description="Include per-outlet recommendation detail in the response.",
    ),
) -> CustomerPriceRecommendation:
    """Single-knob customer-wide profit-maximising price recommendation.

    Searches a uniform price adjustment applied to all included outlets,
    capped at the most-restrictive outlet's safe range, that maximises
    aggregate projected profit.
    """
    return await service.recommend_customer_price(
        customer_id,
        window_days=window_days,
        include_outlets=include_outlets,
    )


def _validate_adjustments(adjustment_pcts: list[float]) -> None:
    if not adjustment_pcts:
        raise HTTPException(
            status_code=400,
            detail="adjustment_pcts must include at least one value.",
        )
    for pct in adjustment_pcts:
        if pct < -0.5 or pct > 0.5:
            raise HTTPException(
                status_code=400,
                detail=f"adjustment_pct {pct} is outside the allowed range "
                "[-0.5, 0.5].",
            )


@router.get(
    "/elasticity/coverage/customer/{customer_id}",
    response_model=CustomerCoverageSummary,
)
async def get_customer_coverage(
    customer_id: str,
    service: ElasticityServiceDep,
    window_days: int = Query(90, ge=14, le=730),
) -> CustomerCoverageSummary:
    """Coverage of persisted Ridge coefficients across customer outlets.

    Useful for sizing a backfill: ``n_missing_viable`` is the number of
    outlets that don't yet have a coefficient but whose price actually
    moves enough that running a Ridge-capable engine over them should
    produce a usable estimate.
    """
    return await service.get_customer_coverage(
        customer_id, window_days=window_days
    )


@router.post(
    "/elasticity/backfill/customer/{customer_id}",
    response_model=CoverageBackfillResponse,
    status_code=202,
)
async def backfill_customer_coverage(
    customer_id: str,
    service: ElasticityServiceDep,
    task_service: TaskServiceDep,
    body: CoverageBackfillRequest = Body(default_factory=CoverageBackfillRequest),
) -> CoverageBackfillResponse:
    """Dispatch a prediction over outlets missing a Ridge coefficient.

    Identifies the ``missing_viable`` outlet list via the same coverage
    diagnostic as ``GET /elasticity/coverage/customer/{id}`` and submits a
    single async prediction task scoped to those outlets, using a
    Ridge-capable engine. The Ridge fit performed inside the prediction
    populates ``covariate_outlet`` for each outlet in the batch.

    Returns ``task_id=null`` and ``n_outlets_dispatched=0`` when nothing
    qualifies — either every outlet already has a coefficient, or none of
    the missing ones have viable price variation.
    """
    coverage = await service.get_customer_coverage(
        customer_id, window_days=body.window_days
    )
    targets = [
        o.outlet_id for o in coverage.outlets if o.state == "missing_viable"
    ]
    if not targets:
        return CoverageBackfillResponse(
            customer_id=customer_id,
            task_id=None,
            n_outlets_dispatched=0,
            engine=body.engine,
            message=(
                "No outlets eligible for backfill. "
                f"with_log={coverage.n_with_log}, "
                f"with_legacy={coverage.n_with_legacy}, "
                f"missing_viable={coverage.n_missing_viable}, "
                f"missing_not_viable={coverage.n_missing_not_viable}."
            ),
        )

    today = date.today()
    request = PredictionRequest(
        customer_id=customer_id,
        outlet_ids=targets,
        prediction_from=today + timedelta(days=1),
        prediction_to=today + timedelta(days=body.prediction_days),
        engine=PredictionEngine(body.engine),
        batch_size=body.batch_size,
        worker=body.worker,
    )
    dispatch_kwargs: dict = {"args": [request.model_dump(mode="json")]}
    if body.worker:
        dispatch_kwargs["queue"] = body.worker
    task = run_prediction_task.apply_async(**dispatch_kwargs)
    await task_service.create(
        task.id,
        "prediction",
        customer_id,
        name=f"Elasticity backfill ({len(targets)} outlets, {body.engine})",
    )
    return CoverageBackfillResponse(
        customer_id=customer_id,
        task_id=task.id,
        n_outlets_dispatched=len(targets),
        engine=body.engine,
        message=(
            f"Dispatched {body.engine} prediction over {len(targets)} outlets "
            f"({body.prediction_days}-day forward window). Ridge coefficients "
            f"will populate when the task completes."
        ),
    )
