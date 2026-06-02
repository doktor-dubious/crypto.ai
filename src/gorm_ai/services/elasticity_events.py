"""Event-based elasticity service.

Replaces the Ridge-on-residuals approximation with a clean change-point
analysis: for each price-change event detected in ``price_history``, run
a univariate forecast (no covariates) anchored at the change date so the
forecast acts as a counterfactual under the *old* price. Compare the
forecast to the actual sales realised under the *new* price; the ratio
yields the elasticity.

ε = log(actual_mean / forecast_mean) / log(price_after / price_before)

Events are detected per (outlet, weekday) partition so customers with
weekday-tier pricing produce distinct estimates per tier — Mon–Sat ε can
differ from Sun ε for the same customer and that should be visible.

This service is independent of the existing ``ElasticityService`` and
``covariate_outlet`` table: it builds its own event-keyed history. The
old service stays in place for forecast-time covariate adjustment.
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, date, datetime, timedelta
from statistics import median

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.elasticity_event import ElasticityEvent
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_group import OutletGroupMember
from gorm_ai.database.models.price_change_event import PriceChangeEvent
from gorm_ai.database.models.price_history import PriceHistory
from gorm_ai.database.models.sales import Sales
from gorm_ai.schemas.elasticity_event import (
    CustomerEventSummary,
    ElasticityEventOut,
    EventConfidence,
    EventWithEstimate,
    OutletEventTimeline,
    PriceChangeEventOut,
)

logger = logging.getLogger(__name__)


# Heuristic confidence thresholds. Tuned to be permissive at the high end
# (we want to surface plausible ε values) but strict at the low end so a
# 3-day post-window doesn't claim a confident ε.
CONF_HIGH_MIN_DAYS = 14
CONF_HIGH_MIN_PRICE_PCT = 0.05  # at least a 5% price move
CONF_MEDIUM_MIN_DAYS = 7
CONF_MEDIUM_MIN_PRICE_PCT = 0.02


def _outlet_display_name(outlet: Outlet) -> str | None:
    name = (outlet.name or "").strip()
    if name:
        return name
    ext = (outlet.ext_id or "").strip()
    return ext or None


def _classify_confidence(
    *,
    n_post_days: int,
    price_pct_change: float,
    epsilon: float | None,
) -> tuple[EventConfidence, str | None]:
    """Confidence in a single per-event ε.

    ε itself is just a ratio — it's only meaningful when the forecast was
    fit on enough context, the price moved enough to be detectable, and the
    post-window has enough days to average over noise.
    """
    if epsilon is None:
        return "insufficient", "Could not compute ε (forecast or actual missing)."
    if not math.isfinite(epsilon):
        return "insufficient", "ε is not finite."
    if n_post_days < CONF_MEDIUM_MIN_DAYS:
        return (
            "low",
            f"Only {n_post_days} day(s) of actuals after the change — too short "
            "to separate the price effect from daily noise.",
        )
    abs_pct = abs(price_pct_change)
    if abs_pct < CONF_MEDIUM_MIN_PRICE_PCT:
        return (
            "low",
            f"Price moved by only {abs_pct * 100:.2f}% — too small to identify "
            "a clean elasticity above forecast noise.",
        )
    if (
        n_post_days >= CONF_HIGH_MIN_DAYS
        and abs_pct >= CONF_HIGH_MIN_PRICE_PCT
    ):
        return "high", None
    return "medium", None


class ElasticityEventService:
    """Detect price-change events and compute per-event elasticity."""

    def __init__(self, session: AsyncSession):
        self.session = session

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    async def list_customer_events(
        self, customer_id: str, *, engine: str, post_days: int
    ) -> list[EventWithEstimate]:
        """Detected events for a customer, paired with the latest estimate."""
        events = await self._fetch_events(customer_id)
        outlets = {o.id: o for o in await self._list_customer_outlets(customer_id)}
        # Bulk-load estimates for these events at the requested (engine, post_days).
        if events:
            event_ids = [e.id for e in events]
            est_result = await self.session.execute(
                select(ElasticityEvent).where(
                    ElasticityEvent.price_change_event_id.in_(event_ids),
                    ElasticityEvent.engine == engine,
                    ElasticityEvent.post_days == post_days,
                    ElasticityEvent.active.is_(True),
                )
            )
            estimates = {
                e.price_change_event_id: e for e in est_result.scalars().all()
            }
        else:
            estimates = {}

        out: list[EventWithEstimate] = []
        for ev in events:
            outlet = outlets.get(ev.outlet_id)
            est = estimates.get(ev.id)
            event_out = self._event_to_out(ev, outlet)
            est_out = self._estimate_to_out(est, outlet) if est else None
            out.append(EventWithEstimate(event=event_out, estimate=est_out))
        return out

    async def get_customer_summary(
        self, customer_id: str, *, engine: str, post_days: int
    ) -> CustomerEventSummary:
        """Aggregated event-based elasticity for a customer."""
        outlets = await self._list_customer_outlets(customer_id)
        events = await self._fetch_events(customer_id)
        event_ids = [e.id for e in events]

        if event_ids:
            est_result = await self.session.execute(
                select(ElasticityEvent).where(
                    ElasticityEvent.price_change_event_id.in_(event_ids),
                    ElasticityEvent.engine == engine,
                    ElasticityEvent.post_days == post_days,
                    ElasticityEvent.active.is_(True),
                )
            )
            estimates = {
                e.price_change_event_id: e for e in est_result.scalars().all()
            }
        else:
            estimates = {}

        # Group events by outlet
        events_by_outlet: dict[str, list[PriceChangeEvent]] = {}
        for ev in events:
            events_by_outlet.setdefault(ev.outlet_id, []).append(ev)

        outlet_timelines: list[OutletEventTimeline] = []
        all_eps: list[float] = []
        for outlet in outlets:
            outlet_events = events_by_outlet.get(outlet.id, [])
            paired: list[EventWithEstimate] = []
            outlet_eps: list[tuple[date, float]] = []
            for ev in outlet_events:
                est = estimates.get(ev.id)
                paired.append(
                    EventWithEstimate(
                        event=self._event_to_out(ev, outlet),
                        estimate=(
                            self._estimate_to_out(est, outlet) if est else None
                        ),
                    )
                )
                if est and est.epsilon is not None and est.confidence in (
                    "high", "medium",
                ):
                    outlet_eps.append((ev.change_date, est.epsilon))
            outlet_timelines.append(
                OutletEventTimeline(
                    outlet_id=outlet.id,
                    outlet_name=_outlet_display_name(outlet),
                    events=paired,
                    median_epsilon=(
                        float(median(v for _, v in outlet_eps)) if outlet_eps else None
                    ),
                    n_events_with_estimate=len(outlet_eps),
                    drift_slope=_drift_slope(outlet_eps),
                )
            )
            all_eps.extend(v for _, v in outlet_eps)

        # Customer-wide drift: pool every (date, ε) pair regardless of outlet.
        all_dated: list[tuple[date, float]] = []
        for outlet in outlets:
            ot = next(
                (t for t in outlet_timelines if t.outlet_id == outlet.id), None
            )
            if not ot:
                continue
            for pair in ot.events:
                est = pair.estimate
                if (
                    est is not None
                    and est.epsilon is not None
                    and est.confidence in ("high", "medium")
                ):
                    all_dated.append((pair.event.change_date, est.epsilon))

        median_e = float(median(all_eps)) if all_eps else None
        p10_e: float | None = None
        p90_e: float | None = None
        if all_eps:
            arr = np.asarray(all_eps, dtype=float)
            p10_e = float(np.quantile(arr, 0.1))
            p90_e = float(np.quantile(arr, 0.9))

        return CustomerEventSummary(
            customer_id=customer_id,
            engine=engine,
            post_days=post_days,
            n_outlets=len(outlets),
            n_events_total=len(events),
            n_events_with_estimate=len(all_eps),
            median_epsilon=median_e,
            p10_epsilon=p10_e,
            p90_epsilon=p90_e,
            drift_slope=_drift_slope(all_dated),
            outlets=outlet_timelines,
        )

    async def detect_events(self, customer_id: str) -> list[PriceChangeEvent]:
        """Scan ``price_history`` for change points and upsert one row per
        (outlet, weekday, change_date).

        ``price_history`` is keyed by (customer, weekday, effective_date) —
        a customer-level ladder, not per-outlet. The detector treats every
        change in that ladder as an event experienced by every active
        outlet in the customer's Production Outlet Group. Outlet-level
        overrides via ``outlet_financial_date`` etc. are not handled in
        this first cut; in the common case they don't exist.

        Idempotent: re-running the detector on the same data is a no-op.
        """
        # Pull price_history rows ordered so we can scan for transitions
        # within each weekday partition.
        result = await self.session.execute(
            select(PriceHistory)
            .where(
                PriceHistory.customer_id == customer_id,
                PriceHistory.active.is_(True),
                PriceHistory.price_per_unit.is_not(None),
            )
            .order_by(PriceHistory.weekday, PriceHistory.effective_date)
        )
        rows = list(result.scalars().all())

        # Build (weekday, change_date, price_before, price_after) transitions.
        transitions: list[tuple[int, date, float, float]] = []
        prev_by_weekday: dict[int, tuple[date, float]] = {}
        for row in rows:
            wd = int(row.weekday)
            price = float(row.price_per_unit) if row.price_per_unit is not None else None
            if price is None:
                continue
            prev = prev_by_weekday.get(wd)
            if prev is not None:
                _prev_date, prev_price = prev
                if round(prev_price, 6) != round(price, 6):
                    transitions.append(
                        (wd, row.effective_date, float(prev_price), float(price))
                    )
            prev_by_weekday[wd] = (row.effective_date, price)

        if not transitions:
            return []

        outlets = await self._list_customer_outlets(customer_id)
        if not outlets:
            return []

        # Bulk upsert (outlet × transition). ON CONFLICT DO NOTHING keeps
        # detection idempotent and lets us re-run safely.
        rows_to_insert: list[dict] = []
        for outlet in outlets:
            for wd, change_date, p_before, p_after in transitions:
                rows_to_insert.append(
                    {
                        "customer_id": customer_id,
                        "outlet_id": outlet.id,
                        "weekday": wd,
                        "change_date": change_date,
                        "price_before": p_before,
                        "price_after": p_after,
                    }
                )

        if rows_to_insert:
            # asyncpg caps each query at 32767 bind parameters. With ~10
            # columns per row, ~1000 rows per chunk stays well under the
            # limit and keeps each round-trip small.
            chunk_size = 1000
            for i in range(0, len(rows_to_insert), chunk_size):
                chunk = rows_to_insert[i : i + chunk_size]
                stmt = pg_insert(PriceChangeEvent.__table__).values(chunk)
                stmt = stmt.on_conflict_do_nothing(
                    constraint="uq_price_change_event_outlet_weekday_date"
                )
                await self.session.execute(stmt)
            await self.session.commit()

        # Return what's now in the table for this customer.
        return await self._fetch_events(customer_id)

    async def compute_epsilon(
        self,
        event_id: str,
        *,
        engine: str,
        post_days: int,
    ) -> ElasticityEvent | None:
        """Compute ε for a single event under (engine, post_days).

        Dispatches a synchronous, single-outlet, single-event prediction
        with covariates disabled so the forecast is the counterfactual at
        the *old* price. Compares forecast vs actual over the post-window
        (restricted to the event's weekday). Persists the row and returns
        it. Returns None if the event was not found.
        """
        # Local import keeps the module import cheap and avoids a circular
        # dependency at startup (PredictionService imports schemas that
        # transitively touch this file).
        from gorm_ai.schemas.prediction import (
            PredictionEngine as PredictionEngineEnum,
        )
        from gorm_ai.schemas.prediction import (
            PredictionRequest,
        )
        from gorm_ai.schemas.simulation import SimulationParameters
        from gorm_ai.services.prediction import PredictionService

        ev = await self.session.get(PriceChangeEvent, event_id)
        if ev is None:
            return None

        # Cap the post-window so it doesn't bleed into the next event for
        # the same (outlet, weekday) — that would contaminate actual_mean.
        next_event_result = await self.session.execute(
            select(func.min(PriceChangeEvent.change_date)).where(
                PriceChangeEvent.outlet_id == ev.outlet_id,
                PriceChangeEvent.weekday == ev.weekday,
                PriceChangeEvent.active.is_(True),
                PriceChangeEvent.change_date > ev.change_date,
            )
        )
        next_change = next_event_result.scalar_one_or_none()
        target_end = ev.change_date + timedelta(days=post_days - 1)
        post_end = target_end
        if next_change is not None and next_change <= target_end:
            post_end = next_change - timedelta(days=1)
        actual_post_days = (post_end - ev.change_date).days + 1
        if actual_post_days < 1:
            return await self._persist_estimate(
                ev,
                engine=engine,
                post_days=post_days,
                forecast_mean=None,
                actual_mean=None,
                n_post_days=0,
                epsilon=None,
                confidence="insufficient",
                reason=(
                    "Window collapsed to zero days because another price "
                    "change for this weekday lands on the same date."
                ),
                task_id=None,
            )

        # Build the prediction request — univariate, no covariates. The
        # ``parameters`` override forces covariate_handling="none" so the
        # forecast acts as a clean counterfactual under the *old* price
        # rather than already absorbing a Ridge-fit price effect.
        request = PredictionRequest(
            customer_id=ev.customer_id,
            outlet_ids=[ev.outlet_id],
            prediction_from=ev.change_date,
            prediction_to=post_end,
            engine=PredictionEngineEnum(engine),
            use_pad=False,
            use_financials=False,
            parameters=SimulationParameters(covariate_handling="none"),
        )

        prediction_service = PredictionService(self.session)
        try:
            response = await prediction_service.create_prediction(request)
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "elasticity_event.predict_failed event=%s engine=%s err=%s",
                ev.id, engine, e,
            )
            return await self._persist_estimate(
                ev,
                engine=engine,
                post_days=post_days,
                forecast_mean=None,
                actual_mean=None,
                n_post_days=0,
                epsilon=None,
                confidence="insufficient",
                reason=f"Prediction failed: {e}",
                task_id=None,
            )

        # Forecast is one outlet's per-day predictions over [change_date, post_end].
        outlet_pred = next(
            (o for o in response.outlets if o.outlet_id == ev.outlet_id), None
        )
        if outlet_pred is None or not outlet_pred.results:
            return await self._persist_estimate(
                ev,
                engine=engine,
                post_days=post_days,
                forecast_mean=None,
                actual_mean=None,
                n_post_days=0,
                epsilon=None,
                confidence="insufficient",
                reason="Engine returned no forecast for this outlet.",
                task_id=None,
            )

        weekday_iso = int(ev.weekday)  # 1=Mon..7=Sun
        # Filter forecast to the matching weekday; otherwise we'd compare
        # weekday tiers against off-tier forecast values.
        fc_values = [
            r.predicted_value
            for r in outlet_pred.results
            if (r.date.weekday() + 1) == weekday_iso
            and r.date >= ev.change_date
            and r.date <= post_end
            and r.predicted_value is not None
        ]

        # Pull actuals for the same outlet, weekday, and date range.
        actuals_result = await self.session.execute(
            select(Sales.date, Sales.sold).where(
                Sales.outlet_id == ev.outlet_id,
                Sales.active.is_(True),
                Sales.date >= ev.change_date,
                Sales.date <= post_end,
                Sales.sold.is_not(None),
            )
        )
        actual_rows = [
            (d, float(s)) for d, s in actuals_result.all()
            if (d.weekday() + 1) == weekday_iso
        ]
        actual_values = [v for _, v in actual_rows]

        if not fc_values or not actual_values:
            return await self._persist_estimate(
                ev,
                engine=engine,
                post_days=post_days,
                forecast_mean=None,
                actual_mean=None,
                n_post_days=len(actual_values),
                epsilon=None,
                confidence="insufficient",
                reason=(
                    "No matching weekday data in the post-window — try a "
                    "longer post-days setting."
                ),
                task_id=None,
            )

        forecast_mean = float(np.mean(fc_values))
        actual_mean = float(np.mean(actual_values))

        epsilon: float | None = None
        if (
            forecast_mean > 0
            and actual_mean > 0
            and ev.price_before > 0
            and ev.price_after > 0
            and ev.price_before != ev.price_after
        ):
            epsilon = math.log(actual_mean / forecast_mean) / math.log(
                ev.price_after / ev.price_before
            )

        price_pct_change = (ev.price_after - ev.price_before) / ev.price_before
        confidence, reason = _classify_confidence(
            n_post_days=len(actual_values),
            price_pct_change=price_pct_change,
            epsilon=epsilon,
        )

        return await self._persist_estimate(
            ev,
            engine=engine,
            post_days=post_days,
            forecast_mean=forecast_mean,
            actual_mean=actual_mean,
            n_post_days=len(actual_values),
            epsilon=epsilon,
            confidence=confidence,
            reason=reason,
            task_id=None,
        )

    async def build_for_customer(
        self,
        customer_id: str,
        *,
        engine: str,
        post_days: int,
        rebuild_existing: bool = False,
    ) -> tuple[list[PriceChangeEvent], int]:
        """Detect events + compute ε for all events missing an estimate.

        Batches by (weekday, change_date) so a single multi-outlet
        prediction call covers every outlet's event for that change. This
        cuts the work from O(events) predictions to O(distinct change
        points), which on Chicago Sun Times means 7 predictions instead
        of 10 000.

        Returns ``(all_events, n_dispatched)``. ``n_dispatched`` is the
        number of (event, engine, post_days) triples that were freshly
        computed in this call.
        """
        events = await self.detect_events(customer_id)
        if not events:
            return [], 0

        # Find events that are missing an estimate at this (engine, post_days).
        existing_result = await self.session.execute(
            select(ElasticityEvent.price_change_event_id).where(
                ElasticityEvent.price_change_event_id.in_([e.id for e in events]),
                ElasticityEvent.engine == engine,
                ElasticityEvent.post_days == post_days,
                ElasticityEvent.active.is_(True),
            )
        )
        existing_ids = {row[0] for row in existing_result.all()}

        targets = [e for e in events if rebuild_existing or e.id not in existing_ids]
        if not targets:
            return events, 0

        # Group by (change_date, weekday) so a single prediction covers
        # all outlets sharing the same change point.
        grouped: dict[tuple[date, int], list[PriceChangeEvent]] = {}
        for ev in targets:
            grouped.setdefault((ev.change_date, int(ev.weekday)), []).append(ev)

        n_done = 0
        for (change_date, weekday), group_events in grouped.items():
            n_done += await self._compute_batch(
                group_events,
                change_date=change_date,
                weekday=weekday,
                engine=engine,
                post_days=post_days,
            )
        return events, n_done

    async def _compute_batch(
        self,
        events: list[PriceChangeEvent],
        *,
        change_date: date,
        weekday: int,
        engine: str,
        post_days: int,
    ) -> int:
        """Compute ε for a batch of events sharing the same change point.

        Dispatches one multi-outlet, no-covariate prediction over
        [change_date, change_date+post_days-1]. For each outlet, builds
        the per-event ε from its forecast restricted to ``weekday`` and
        the matching actuals. Persists every event's estimate (including
        rows where the computation failed, so the UI can show a reason).
        """
        if not events:
            return 0

        from gorm_ai.schemas.prediction import (
            PredictionEngine as PredictionEngineEnum,
        )
        from gorm_ai.schemas.prediction import (
            PredictionRequest,
        )
        from gorm_ai.schemas.simulation import SimulationParameters
        from gorm_ai.services.prediction import PredictionService

        outlet_ids = [e.outlet_id for e in events]
        customer_id = events[0].customer_id

        # Per-outlet truncation of the post window: stop before the next
        # change for the same (outlet, weekday) so actuals don't leak in.
        next_change_result = await self.session.execute(
            select(
                PriceChangeEvent.outlet_id,
                func.min(PriceChangeEvent.change_date),
            )
            .where(
                PriceChangeEvent.outlet_id.in_(outlet_ids),
                PriceChangeEvent.weekday == weekday,
                PriceChangeEvent.active.is_(True),
                PriceChangeEvent.change_date > change_date,
            )
            .group_by(PriceChangeEvent.outlet_id)
        )
        next_change_by_outlet = dict(next_change_result.all())

        target_end = change_date + timedelta(days=post_days - 1)

        request = PredictionRequest(
            customer_id=customer_id,
            outlet_ids=outlet_ids,
            prediction_from=change_date,
            prediction_to=target_end,
            engine=PredictionEngineEnum(engine),
            use_pad=False,
            use_financials=False,
            parameters=SimulationParameters(covariate_handling="none"),
        )

        prediction_service = PredictionService(self.session)
        try:
            response = await prediction_service.create_prediction(request)
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "elasticity_event.batch_predict_failed weekday=%s date=%s err=%s",
                weekday, change_date, e,
            )
            for ev in events:
                await self._persist_estimate(
                    ev,
                    engine=engine,
                    post_days=post_days,
                    forecast_mean=None,
                    actual_mean=None,
                    n_post_days=0,
                    epsilon=None,
                    confidence="insufficient",
                    reason=f"Prediction failed: {e}",
                    task_id=None,
                )
            return len(events)

        forecast_by_outlet: dict[str, list] = {}
        for outlet_pred in response.outlets:
            forecast_by_outlet[outlet_pred.outlet_id] = outlet_pred.results

        # Bulk-fetch actuals for every outlet across the window. Filter to
        # matching weekday in Python — small data, simple, no ORM hassle.
        actuals_result = await self.session.execute(
            select(Sales.outlet_id, Sales.date, Sales.sold).where(
                Sales.outlet_id.in_(outlet_ids),
                Sales.active.is_(True),
                Sales.date >= change_date,
                Sales.date <= target_end,
                Sales.sold.is_not(None),
            )
        )
        actuals_by_outlet: dict[str, list[tuple[date, float]]] = {}
        for oid, d, sold in actuals_result.all():
            if (d.weekday() + 1) != weekday:
                continue
            actuals_by_outlet.setdefault(oid, []).append((d, float(sold)))

        n = 0
        for ev in events:
            outlet_results = forecast_by_outlet.get(ev.outlet_id) or []
            outlet_actuals = actuals_by_outlet.get(ev.outlet_id, [])

            # Per-outlet post-end (cap at next change for this weekday).
            outlet_post_end = target_end
            next_change = next_change_by_outlet.get(ev.outlet_id)
            if next_change is not None and next_change <= target_end:
                outlet_post_end = next_change - timedelta(days=1)

            fc_values = [
                r.predicted_value
                for r in outlet_results
                if (r.date.weekday() + 1) == weekday
                and change_date <= r.date <= outlet_post_end
                and r.predicted_value is not None
            ]
            actual_values = [
                v for d, v in outlet_actuals if d <= outlet_post_end
            ]

            if not fc_values or not actual_values:
                await self._persist_estimate(
                    ev,
                    engine=engine,
                    post_days=post_days,
                    forecast_mean=None,
                    actual_mean=None,
                    n_post_days=len(actual_values),
                    epsilon=None,
                    confidence="insufficient",
                    reason=(
                        "No matching weekday data in the post-window — try "
                        "a longer post-days setting."
                    ),
                    task_id=None,
                )
                n += 1
                continue

            forecast_mean = float(np.mean(fc_values))
            actual_mean = float(np.mean(actual_values))

            epsilon: float | None = None
            if (
                forecast_mean > 0
                and actual_mean > 0
                and ev.price_before > 0
                and ev.price_after > 0
                and ev.price_before != ev.price_after
            ):
                epsilon = math.log(actual_mean / forecast_mean) / math.log(
                    ev.price_after / ev.price_before
                )

            price_pct_change = (
                (ev.price_after - ev.price_before) / ev.price_before
            )
            confidence, reason = _classify_confidence(
                n_post_days=len(actual_values),
                price_pct_change=price_pct_change,
                epsilon=epsilon,
            )

            await self._persist_estimate(
                ev,
                engine=engine,
                post_days=post_days,
                forecast_mean=forecast_mean,
                actual_mean=actual_mean,
                n_post_days=len(actual_values),
                epsilon=epsilon,
                confidence=confidence,
                reason=reason,
                task_id=None,
            )
            n += 1
        return n

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    async def _list_customer_outlets(self, customer_id: str) -> list[Outlet]:
        """Active outlets in the customer's Production Outlet Group.

        Mirrors ``ElasticityService._list_customer_outlets``: prefer the
        configured group, fall back to all active outlets when nothing
        is configured.
        """
        group_id = await self.session.scalar(
            select(CustomerConfiguration.group_id).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        stmt = select(Outlet).where(
            Outlet.customer_id == customer_id,
            Outlet.active.is_(True),
        )
        if group_id is not None:
            stmt = stmt.join(
                OutletGroupMember, OutletGroupMember.outlet_id == Outlet.id
            ).where(
                OutletGroupMember.group_id == group_id,
                OutletGroupMember.active.is_(True),
            )
        stmt = stmt.order_by(Outlet.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def _fetch_events(self, customer_id: str) -> list[PriceChangeEvent]:
        result = await self.session.execute(
            select(PriceChangeEvent)
            .where(
                PriceChangeEvent.customer_id == customer_id,
                PriceChangeEvent.active.is_(True),
            )
            .order_by(PriceChangeEvent.change_date, PriceChangeEvent.outlet_id)
        )
        return list(result.scalars().all())

    async def _persist_estimate(
        self,
        ev: PriceChangeEvent,
        *,
        engine: str,
        post_days: int,
        forecast_mean: float | None,
        actual_mean: float | None,
        n_post_days: int,
        epsilon: float | None,
        confidence: EventConfidence,
        reason: str | None,
        task_id: str | None,
    ) -> ElasticityEvent:
        # Upsert on (event, engine, post_days) — overwrite stale runs.
        stmt = (
            pg_insert(ElasticityEvent.__table__)
            .values(
                price_change_event_id=ev.id,
                outlet_id=ev.outlet_id,
                engine=engine,
                post_days=post_days,
                task_id=task_id,
                forecast_mean=forecast_mean,
                actual_mean=actual_mean,
                n_post_days=n_post_days,
                epsilon=epsilon,
                confidence=confidence,
                reason=reason,
                computed_at=datetime.now(UTC),
            )
            .returning(ElasticityEvent.__table__.c.id)
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_elasticity_event_event_engine_post",
            set_={
                "task_id": task_id,
                "forecast_mean": forecast_mean,
                "actual_mean": actual_mean,
                "n_post_days": n_post_days,
                "epsilon": epsilon,
                "confidence": confidence,
                "reason": reason,
                "computed_at": datetime.now(UTC),
                "active": True,
                "updated_at": datetime.now(UTC),
            },
        )
        result = await self.session.execute(stmt)
        await self.session.commit()
        new_id = result.scalar_one()
        return await self.session.get(ElasticityEvent, new_id)

    def _event_to_out(
        self, ev: PriceChangeEvent, outlet: Outlet | None
    ) -> PriceChangeEventOut:
        pct = 0.0
        if ev.price_before:
            pct = (ev.price_after - ev.price_before) / ev.price_before
        return PriceChangeEventOut(
            id=ev.id,
            customer_id=ev.customer_id,
            outlet_id=ev.outlet_id,
            outlet_name=_outlet_display_name(outlet) if outlet else None,
            weekday=int(ev.weekday),
            change_date=ev.change_date,
            price_before=float(ev.price_before),
            price_after=float(ev.price_after),
            pct_change=pct,
        )

    def _estimate_to_out(
        self, est: ElasticityEvent, outlet: Outlet | None
    ) -> ElasticityEventOut:
        return ElasticityEventOut(
            id=est.id,
            price_change_event_id=est.price_change_event_id,
            outlet_id=est.outlet_id,
            outlet_name=_outlet_display_name(outlet) if outlet else None,
            engine=est.engine,
            post_days=int(est.post_days),
            task_id=est.task_id,
            forecast_mean=est.forecast_mean,
            actual_mean=est.actual_mean,
            n_post_days=int(est.n_post_days),
            epsilon=est.epsilon,
            confidence=est.confidence,  # type: ignore[arg-type]
            reason=est.reason,
            computed_at=est.computed_at,
        )


def _drift_slope(dated_eps: list[tuple[date, float]]) -> float | None:
    """Slope of ε vs change_date in (units of ε) per year.

    Simple OLS line through the points. None if we have < 3 points or all
    on the same date. Used as a lightweight signal that elasticity may be
    drifting; not a confidence statement.
    """
    if len(dated_eps) < 3:
        return None
    ref = min(d for d, _ in dated_eps)
    xs = np.asarray(
        [(d - ref).days / 365.25 for d, _ in dated_eps], dtype=float
    )
    ys = np.asarray([e for _, e in dated_eps], dtype=float)
    if float(np.std(xs)) < 1e-9:
        return None
    slope, _intercept = np.polyfit(xs, ys, 1)
    return float(slope)


