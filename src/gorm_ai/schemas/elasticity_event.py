"""Schemas for the event-based elasticity service."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from gorm_ai.schemas.elasticity import RidgeCapableEngine

EventConfidence = Literal["high", "medium", "low", "insufficient"]


class PriceChangeEventOut(BaseModel):
    """A single detected price change for an (outlet, weekday) partition."""

    id: str
    customer_id: str
    outlet_id: str
    outlet_name: str | None = None
    weekday: int  # 1=Mon..7=Sun (matches price_history convention)
    change_date: date
    price_before: float
    price_after: float
    pct_change: float  # (price_after - price_before) / price_before


class ElasticityEventOut(BaseModel):
    """One ε estimate for a price-change event under a given engine + window."""

    id: str
    price_change_event_id: str
    outlet_id: str
    outlet_name: str | None = None
    engine: str
    post_days: int
    task_id: str | None = None
    forecast_mean: float | None = None
    actual_mean: float | None = None
    n_post_days: int = 0
    epsilon: float | None = None
    confidence: EventConfidence = "insufficient"
    reason: str | None = None
    computed_at: datetime | None = None


class EventWithEstimate(BaseModel):
    """A price-change event paired with its latest elasticity estimate."""

    event: PriceChangeEventOut
    estimate: ElasticityEventOut | None = None


class OutletEventTimeline(BaseModel):
    """All detected events for one outlet with their estimates."""

    outlet_id: str
    outlet_name: str | None = None
    events: list[EventWithEstimate]
    median_epsilon: float | None = None
    n_events_with_estimate: int = 0
    drift_slope: float | None = None  # ε per year, simple linear regression


class CustomerEventSummary(BaseModel):
    """Aggregated event-based elasticity across all outlets in a customer."""

    customer_id: str
    engine: str
    post_days: int
    n_outlets: int
    n_events_total: int
    n_events_with_estimate: int
    median_epsilon: float | None = None
    p10_epsilon: float | None = None
    p90_epsilon: float | None = None
    drift_slope: float | None = None
    outlets: list[OutletEventTimeline]


class EventBuildRequest(BaseModel):
    """Parameters for building events + dispatching ε computations."""

    engine: RidgeCapableEngine = "flowstate"
    post_days: int = Field(default=30, ge=7, le=180)
    rebuild_existing: bool = False
    worker: str | None = None


class EventBuildResponse(BaseModel):
    """Result of an event-build dispatch."""

    customer_id: str
    n_events_detected: int
    n_events_dispatched: int
    task_ids: list[str]
    engine: str
    post_days: int
    message: str
