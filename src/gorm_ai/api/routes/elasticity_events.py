"""Event-based elasticity API.

These endpoints power the Pricing Analytics → Events tab. They are
independent from the legacy Ridge-coefficient analytics in
``analytics.py`` (which still serves the Coverage card etc.).
"""

from fastapi import APIRouter, HTTPException, Query

from gorm_ai.api.deps import ElasticityEventServiceDep
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.schemas.elasticity_event import (
    CustomerEventSummary,
    ElasticityEventOut,
    EventBuildRequest,
    EventBuildResponse,
    EventWithEstimate,
)

router = APIRouter()


@router.get(
    "/customer/{customer_id}", response_model=CustomerEventSummary,
)
async def get_customer_summary(
    customer_id: str,
    service: ElasticityEventServiceDep,
    engine: str = Query("flowstate"),
    post_days: int = Query(30, ge=7, le=180),
) -> CustomerEventSummary:
    """Aggregated event-based elasticity for a customer.

    Returns the median ε across all events with usable estimates plus the
    per-outlet timeline. Events without an estimate at this (engine,
    post_days) appear in the timeline with ``estimate=None`` — call
    ``POST /build`` to compute them.
    """
    return await service.get_customer_summary(
        customer_id, engine=engine, post_days=post_days,
    )


@router.get(
    "/customer/{customer_id}/events",
    response_model=list[EventWithEstimate],
)
async def list_customer_events(
    customer_id: str,
    service: ElasticityEventServiceDep,
    engine: str = Query("flowstate"),
    post_days: int = Query(30, ge=7, le=180),
) -> list[EventWithEstimate]:
    """Flat list of every detected event paired with its latest estimate."""
    return await service.list_customer_events(
        customer_id, engine=engine, post_days=post_days,
    )


@router.post(
    "/build/customer/{customer_id}", response_model=EventBuildResponse,
)
async def build_customer_events(
    customer_id: str,
    service: ElasticityEventServiceDep,
    body: EventBuildRequest,
) -> EventBuildResponse:
    """Detect events from price_history + compute ε for those missing an estimate.

    Synchronous: runs detection and the batched per-event ε computations
    in-process. For customers with many distinct change dates this can
    take a while (one prediction per change point). The endpoint returns
    when all events have been processed.
    """
    events, n_dispatched = await service.build_for_customer(
        customer_id,
        engine=body.engine,
        post_days=body.post_days,
        rebuild_existing=body.rebuild_existing,
    )
    return EventBuildResponse(
        customer_id=customer_id,
        n_events_detected=len(events),
        n_events_dispatched=n_dispatched,
        task_ids=[],
        engine=body.engine,
        post_days=body.post_days,
        message=(
            f"Detected {len(events)} events; computed {n_dispatched} new "
            f"ε estimates for ({body.engine}, post_days={body.post_days})."
        ),
    )


@router.post(
    "/event/{event_id}/recompute", response_model=ElasticityEventOut,
)
async def recompute_event(
    event_id: str,
    service: ElasticityEventServiceDep,
    engine: str = Query("flowstate"),
    post_days: int = Query(30, ge=7, le=180),
) -> ElasticityEventOut:
    """Recompute ε for a single event under (engine, post_days)."""
    estimate = await service.compute_epsilon(
        event_id, engine=engine, post_days=post_days,
    )
    if estimate is None:
        raise HTTPException(status_code=404, detail="Event not found")
    # Match list_customer_events output shape: include outlet_name when known.
    outlet = await service.session.get(Outlet, estimate.outlet_id)
    return service._estimate_to_out(estimate, outlet)  # type: ignore[attr-defined]
