"""Cohort audit service: per-sub-group driver-skip detection.

A skip is detected on the **sold** channel, not delivered: drivers
self-report delivery quantities and may falsify them, so `delivered`
is not ground truth. Plus, by ingest rule every sales row has
`delivered > 0` — rows with `delivered <= 0` are filtered out — so
the delivered channel carries no signal here. The canonical abnormal
pattern is `sold ≈ 0` on a day the outlet normally sells.

Solo zero-sales are ambiguous (could be slow business). The
disambiguation comes from cohort co-occurrence: when many outlets on
the same route all show zero-sales on the same day, that's a driver
event. The Tail-Concentration Score (TCS) quantifies that concentration
as the mean Kendall tau-b between event-membership and per-outlet skip
count, with a permutation p-value.

Missing rows on expected delivery days are tracked in a separate
"no-report" channel — they're ambiguous (could be a genuine skip, a
data-pipeline gap, an unobserved closure) and would inflate false-positive
rates if folded into the skip count. Reported alongside but not fed
into the TCS.

When the caller asserts the cohort is sequenced and TCS is significant,
we also infer a tail ordering via pairwise dominance: outlet A is
"later" than B when P(A skipped | B skipped) is high but P(B | A) is
not.
"""

from collections import defaultdict
from datetime import date, timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.outlet import Outlet
from crypto_ai.database.models.outlet_delivery import OutletDelivery
from crypto_ai.database.models.outlet_info import OutletInfo
from crypto_ai.database.models.pad import Pad, PadDate
from crypto_ai.database.models.sales import Sales
from crypto_ai.database.models.sales_filter import SalesFilter


class CohortAuditService:
    """Detect driver-skip patterns per cohort."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def audit(
        self,
        customer_id: str,
        outlet_info_key: str,
        start_date: date,
        end_date: date,
        outlet_info_values: list[str] | None = None,
        sequenced: bool = False,
        shared_driver: bool = False,
        skip_threshold_pct: float = 0.2,
        min_baseline: float = 3.0,
        delivery_floor: int = 2,
    ) -> dict:
        notes: list[str] = []

        membership = await self._fetch_cohort_membership(
            customer_id, outlet_info_key, outlet_info_values,
        )
        if not membership:
            return self._empty_response(
                start_date, end_date,
                [f"No outlets found with outlet_info.key='{outlet_info_key}'"
                 + (f" and value in {outlet_info_values}" if outlet_info_values else "") + "."],
            )

        cohort_to_outlets: dict[str, list[str]] = defaultdict(list)
        for oid, val in membership:
            cohort_to_outlets[val].append(oid)
        all_outlet_ids = [oid for oid, _ in membership]

        outlet_info = await self._fetch_outlet_info(all_outlet_ids)
        outlet_dates = await self._fetch_outlet_date_ranges(all_outlet_ids)
        open_weekdays = await self._fetch_open_weekdays(all_outlet_ids)
        sales = await self._fetch_sales(
            customer_id, all_outlet_ids, start_date, end_date,
        )
        if not sales:
            notes.append("No sales rows found in the selected window.")
        filtered_dates = await self._fetch_filtered_dates(
            customer_id, start_date, end_date,
        )
        pad_dates = await self._fetch_pad_dates(customer_id)

        # Clamp the analysis window to the customer's most recent sale date.
        # The detector flags missing rows on expected delivery days, so a
        # stale data tail would otherwise produce a torrent of false-positive
        # skips for every outlet for every day after data stopped.
        effective_end = end_date
        if sales:
            last_sale = max(s[1] for s in sales)
            if last_sale < end_date:
                notes.append(
                    f"Sales data ends {last_sale.isoformat()}; trimming "
                    f"detection window from requested end "
                    f"{end_date.isoformat()}."
                )
                effective_end = last_sale

        # Skip detection runs on `sold`: a skip is a zero-sale (or near-zero)
        # on an expected delivery day at an outlet whose normal sold volume
        # meets `min_baseline`. Missing rows on expected days are tracked
        # separately as "no-report" — they're ambiguous and don't enter TCS.
        expected_dates = self._compute_expected_dates(
            all_outlet_ids, outlet_dates, open_weekdays,
            pad_dates, filtered_dates,
            start_date, effective_end,
        )
        baselines = self._compute_baselines(sales, pad_dates, filtered_dates)
        outlet_skip_dates, outlet_no_report_dates = self._detect_skips(
            sales, baselines, expected_dates,
            skip_threshold_pct, min_baseline,
        )
        active_open_days = {
            oid: len(dates) for oid, dates in expected_dates.items()
        }

        # Outlets that fall below min_baseline on all weekdays are excluded
        # from skip detection — surface this as a note so users know.
        no_baseline_count = sum(
            1 for oid in all_outlet_ids
            if oid not in baselines or all(
                b < min_baseline for b in baselines[oid].values()
            )
        )
        if no_baseline_count:
            notes.append(
                f"{no_baseline_count} outlet(s) have baseline delivery "
                f"< {min_baseline:g} on every open weekday and were "
                f"excluded from skip detection (too low-volume)."
            )

        cohort_results = []
        for cohort_val, outlet_ids in sorted(cohort_to_outlets.items()):
            cohort_results.append(self._analyze_cohort(
                cohort_value=cohort_val,
                outlet_ids=outlet_ids,
                outlet_info=outlet_info,
                outlet_skip_dates=outlet_skip_dates,
                outlet_no_report_dates=outlet_no_report_dates,
                active_open_days=active_open_days,
                sequenced=sequenced,
                delivery_floor=delivery_floor,
            ))

        cohorts_with_signal = sum(
            1 for c in cohort_results if c["skip_event_count"] >= 5
        )

        return {
            "cohorts": cohort_results,
            "universe_size": len(all_outlet_ids),
            "cohorts_with_signal": cohorts_with_signal,
            "skip_detection_window": {
                "start_date": start_date,
                "end_date": end_date,
            },
            "notes": notes,
        }

    # ─── Data fetchers ──────────────────────────────────────────────────────

    async def _fetch_cohort_membership(
        self,
        customer_id: str,
        info_key: str,
        info_values: list[str] | None,
    ) -> list[tuple[str, str]]:
        q = (
            select(OutletInfo.outlet_id, OutletInfo.value)
            .join(Outlet, Outlet.id == OutletInfo.outlet_id)
            .where(
                Outlet.customer_id == customer_id,
                Outlet.active.is_(True),
                OutletInfo.key == info_key,
                OutletInfo.active.is_(True),
                OutletInfo.value.is_not(None),
            )
        )
        if info_values:
            q = q.where(OutletInfo.value.in_(info_values))
        result = await self.session.execute(q)
        return [(r.outlet_id, r.value) for r in result.all()]

    async def _fetch_outlet_info(
        self, outlet_ids: list[str],
    ) -> dict[str, tuple[str, str]]:
        if not outlet_ids:
            return {}
        result = await self.session.execute(
            select(Outlet.id, Outlet.ext_id, Outlet.name).where(
                Outlet.id.in_(outlet_ids),
            )
        )
        return {
            r.id: (r.ext_id or "", r.name or "Unknown")
            for r in result.all()
        }

    async def _fetch_outlet_date_ranges(
        self, outlet_ids: list[str],
    ) -> dict[str, tuple[date | None, date | None]]:
        if not outlet_ids:
            return {}
        result = await self.session.execute(
            select(
                Outlet.id, Outlet.start_date, Outlet.end_date,
            ).where(Outlet.id.in_(outlet_ids))
        )
        return {
            r.id: (r.start_date, r.end_date) for r in result.all()
        }

    async def _fetch_open_weekdays(
        self, outlet_ids: list[str],
    ) -> dict[str, set[int]]:
        if not outlet_ids:
            return {}
        result = await self.session.execute(
            select(
                OutletDelivery.outlet_id, OutletDelivery.weekday,
            ).where(
                OutletDelivery.outlet_id.in_(outlet_ids),
                OutletDelivery.open.is_(True),
                OutletDelivery.active.is_(True),
            )
        )
        out: dict[str, set[int]] = defaultdict(set)
        for r in result.all():
            out[r.outlet_id].add(r.weekday)
        return dict(out)

    async def _fetch_sales(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
    ) -> list[tuple[str, date, int, int | None]]:
        if not outlet_ids:
            return []
        result = await self.session.execute(
            select(
                Sales.outlet_id, Sales.date, Sales.sold, Sales.delivered,
            ).where(
                Sales.customer_id == customer_id,
                Sales.outlet_id.in_(outlet_ids),
                Sales.date >= start_date,
                Sales.date <= end_date,
                Sales.active.is_(True),
            )
        )
        return [
            (r.outlet_id, r.date, r.sold, r.delivered)
            for r in result.all()
        ]

    async def _fetch_filtered_dates(
        self, customer_id: str, start_date: date, end_date: date,
    ) -> set[date]:
        result = await self.session.execute(
            select(SalesFilter.from_date, SalesFilter.to_date).where(
                SalesFilter.customer_id == customer_id,
                SalesFilter.active.is_(True),
                SalesFilter.from_date <= end_date,
                SalesFilter.to_date >= start_date,
            )
        )
        excluded: set[date] = set()
        for r in result.all():
            d = max(r.from_date, start_date)
            end = min(r.to_date, end_date)
            while d <= end:
                excluded.add(d)
                d += timedelta(days=1)
        return excluded

    async def _fetch_pad_dates(self, customer_id: str) -> set[date]:
        result = await self.session.execute(
            select(PadDate.date).join(Pad, PadDate.pad_id == Pad.id).where(
                Pad.customer_id == customer_id,
                Pad.active.is_(True),
                PadDate.active.is_(True),
            )
        )
        return {r.date for r in result.all()}

    # ─── Algorithms ─────────────────────────────────────────────────────────

    def _compute_baselines(
        self,
        sales: list[tuple],
        pad_dates: set[date],
        filtered_dates: set[date],
    ) -> dict[str, dict[int, float]]:
        """Per-outlet, per-weekday median of non-zero `sold`, with PAD and
        sales-filter dates excluded. Non-zero-only because we want
        "how much do they sell on a normal selling day" — the answer to
        which then tells us when a zero-sale is anomalous."""
        by_outlet_wd: dict[str, dict[int, list[float]]] = defaultdict(
            lambda: defaultdict(list),
        )
        for oid, d, sold, _delivered in sales:
            if sold is None or sold <= 0:
                continue
            if d in pad_dates or d in filtered_dates:
                continue
            by_outlet_wd[oid][d.isoweekday()].append(float(sold))
        out: dict[str, dict[int, float]] = {}
        for oid, wd_map in by_outlet_wd.items():
            out[oid] = {
                wd: float(np.median(vals)) for wd, vals in wd_map.items()
            }
        return out

    def _compute_expected_dates(
        self,
        outlet_ids: list[str],
        outlet_dates: dict[str, tuple[date | None, date | None]],
        open_weekdays: dict[str, set[int]],
        pad_dates: set[date],
        filtered_dates: set[date],
        window_start: date,
        window_end: date,
    ) -> dict[str, set[date]]:
        """Per-outlet set of dates a delivery is expected: open weekdays in
        the intersection of [window, outlet active range], minus PAD and
        filtered dates."""
        out: dict[str, set[date]] = {}
        for oid in outlet_ids:
            wds = open_weekdays.get(oid, set())
            if not wds:
                out[oid] = set()
                continue
            sd, ed = outlet_dates.get(oid, (None, None))
            start = max(window_start, sd) if sd else window_start
            end = min(window_end, ed) if ed else window_end
            if start > end:
                out[oid] = set()
                continue
            dates: set[date] = set()
            d = start
            while d <= end:
                if (
                    d.isoweekday() in wds
                    and d not in pad_dates
                    and d not in filtered_dates
                ):
                    dates.add(d)
                d += timedelta(days=1)
            out[oid] = dates
        return out

    def _detect_skips(
        self,
        sales: list[tuple],
        baselines: dict[str, dict[int, float]],
        expected_dates: dict[str, set[date]],
        threshold_pct: float,
        min_baseline: float,
    ) -> tuple[
        dict[str, list[tuple[date, int]]], dict[str, list[date]],
    ]:
        """Returns (skips, no_reports).

        skips[outlet_id] = sorted list of (date, delivered_value) tuples
        where a row exists with `sold <= threshold * sold_baseline` and
        the outlet's weekday sold baseline meets `min_baseline`. The
        `delivered_value` is the driver-reported drop quantity on that
        day; callers use it to qualify skip severity (e.g. above-floor
        skips are more informative than at-floor skips, since the floor
        is the system default for any non-selling stop).

        no_reports[outlet_id] = sorted dates where the outlet was
        expected to receive a delivery but no sales row exists. Tracked
        separately and do not enter the TCS — the meaning of a missing
        row is ambiguous (genuine skip, data gap, unobserved closure)
        and folding them in inflates false positives.
        """
        sales_by_outlet: dict[
            str, dict[date, tuple[int | None, int | None]],
        ] = defaultdict(dict)
        for oid, d, sold, delivered in sales:
            sales_by_outlet[oid][d] = (sold, delivered)

        skips: dict[str, list[tuple[date, int]]] = defaultdict(list)
        no_reports: dict[str, list[date]] = defaultdict(list)
        for oid, exp in expected_dates.items():
            outlet_baselines = baselines.get(oid, {})
            actual = sales_by_outlet.get(oid, {})
            for d in exp:
                wd = d.isoweekday()
                baseline = outlet_baselines.get(wd, 0.0)
                if baseline < min_baseline:
                    continue
                if d not in actual:
                    no_reports[oid].append(d)
                    continue
                sold, delivered = actual[d]
                got = sold if sold is not None else 0
                if got <= threshold_pct * baseline:
                    skips[oid].append(
                        (d, int(delivered) if delivered is not None else 0),
                    )
        return (
            {k: sorted(v, key=lambda x: x[0]) for k, v in skips.items()},
            {k: sorted(v) for k, v in no_reports.items()},
        )

    def _analyze_cohort(
        self,
        cohort_value: str,
        outlet_ids: list[str],
        outlet_info: dict[str, tuple[str, str]],
        outlet_skip_dates: dict[str, list[tuple[date, int]]],
        outlet_no_report_dates: dict[str, list[date]],
        active_open_days: dict[str, int],
        sequenced: bool,
        delivery_floor: int,
    ) -> dict:
        # Skip events restricted to this cohort's outlets.
        date_to_event: dict[date, set[str]] = defaultdict(set)
        skip_count_per_outlet: dict[str, int] = defaultdict(int)
        above_floor_per_outlet: dict[str, int] = defaultdict(int)
        for oid in outlet_ids:
            for d, delivered in outlet_skip_dates.get(oid, []):
                date_to_event[d].add(oid)
                skip_count_per_outlet[oid] += 1
                if delivered > delivery_floor:
                    above_floor_per_outlet[oid] += 1

        events = sorted(date_to_event.items())
        skip_event_count = len(events)
        total_skip_obs = sum(len(s) for _, s in events)

        # No-report tally (separate channel).
        no_report_count_per_outlet: dict[str, int] = {
            oid: len(outlet_no_report_dates.get(oid, []))
            for oid in outlet_ids
        }
        cohort_no_report_count = sum(no_report_count_per_outlet.values())

        weekday_dist = [0] * 7
        for d, _ in events:
            weekday_dist[d.isoweekday() - 1] += 1
        top_weekday = (
            max(range(1, 8), key=lambda w: weekday_dist[w - 1])
            if any(weekday_dist) else None
        )

        sorted_outlets = sorted(
            outlet_ids,
            key=lambda oid: (-skip_count_per_outlet.get(oid, 0), oid),
        )
        outlet_stats = []
        for rank, oid in enumerate(sorted_outlets, start=1):
            ext_id, name = outlet_info.get(oid, ("", "Unknown"))
            sc = skip_count_per_outlet.get(oid, 0)
            aod = active_open_days.get(oid, 0)
            outlet_stats.append({
                "outlet_id": oid,
                "outlet_name": name,
                "ext_id": ext_id,
                "skip_count": sc,
                "above_floor_skip_count": above_floor_per_outlet.get(oid, 0),
                "skip_rate": round(sc / aod, 4) if aod > 0 else 0.0,
                "active_open_days": aod,
                "rank": rank,
                "inferred_sequence_rank": None,
                "no_report_count": no_report_count_per_outlet.get(oid, 0),
            })

        # Overall skip rate = pooled (total skips / total active open days).
        total_aod = sum(s["active_open_days"] for s in outlet_stats)
        overall_skip_rate = (
            total_skip_obs / total_aod if total_aod > 0 else 0.0
        )

        event_sets = [s for _, s in events]
        if skip_event_count >= 5 and len(outlet_ids) >= 4:
            tcs, tcs_p = self._compute_tcs(
                outlet_ids=outlet_ids,
                event_sets=event_sets,
                skip_counts=skip_count_per_outlet,
                n_permutations=200,
            )
        else:
            tcs, tcs_p = None, None

        inferred_tail: list[str] | None = None
        seq_confidence: str | None = None
        if (
            sequenced
            and tcs is not None
            and tcs_p is not None
            and tcs_p < 0.05
            and tcs > 0.3
        ):
            tail, confidence, seq_ranks = self._infer_sequence(
                outlet_ids=outlet_ids,
                event_sets=event_sets,
                skip_counts=skip_count_per_outlet,
            )
            inferred_tail = tail
            seq_confidence = confidence
            for s in outlet_stats:
                s["inferred_sequence_rank"] = seq_ranks.get(s["outlet_id"])

        skip_events_list = [
            {
                "date": d,
                "weekday": d.isoweekday(),
                "skipped_outlet_ids": sorted(s),
                "skipped_count": len(s),
            }
            for d, s in events
        ]

        return {
            "cohort_value": cohort_value,
            "outlet_count": len(outlet_ids),
            "skip_event_count": skip_event_count,
            "total_skip_observations": total_skip_obs,
            "overall_skip_rate": round(overall_skip_rate, 4),
            "tcs": round(tcs, 4) if tcs is not None else None,
            "tcs_p_value": round(tcs_p, 4) if tcs_p is not None else None,
            "no_report_count": cohort_no_report_count,
            "weekday_distribution": weekday_dist,
            "top_weekday": top_weekday,
            "outlets": outlet_stats,
            "skip_events": skip_events_list,
            "inferred_tail_outlets": inferred_tail,
            "sequence_confidence": seq_confidence,
        }

    def _compute_tcs(
        self,
        outlet_ids: list[str],
        event_sets: list[set[str]],
        skip_counts: dict[str, int],
        n_permutations: int = 200,
        rng_seed: int = 42,
    ) -> tuple[float | None, float | None]:
        """Tail-Concentration Score = mean Kendall tau-b across events,
        with leave-one-out counts. Permutation p-value under "events are
        random size-matched samples".

        Since the membership vector is binary, we don't call scipy's
        kendalltau per event — we compute tau-b directly from the sign
        matrix of the count differences. For binary `m` and ordinal `c`:

            C - D = sum_{i,j} (m[i] - m[j]) * sign(c[i] - c[j]) / 2

        with denominator sqrt((Np - T_m) * (Np - T_c)) where T_m and T_c
        are the within-vector tie pair counts and Np = n*(n-1)/2. One
        n×n elementwise multiply per event — orders of magnitude faster
        than scipy when running 200 permutations.
        """
        n = len(outlet_ids)
        idx = {oid: i for i, oid in enumerate(outlet_ids)}
        counts_full = np.array(
            [skip_counts.get(oid, 0) for oid in outlet_ids], dtype=float,
        )

        sets = [s for s in event_sets if s]
        if len(sets) < 5:
            return None, None

        # Pre-build per-event 0/1 membership matrix (rows = events).
        memb_matrix = np.zeros((len(sets), n), dtype=np.float64)
        for j, s in enumerate(sets):
            for oid in s:
                if oid in idx:
                    memb_matrix[j, idx[oid]] = 1.0

        observed = self._tcs_from_membership(
            memb_matrix, counts_full,
        )
        if observed is None or np.isnan(observed):
            return None, None

        # Permutation null: replace each event's membership with a random
        # size-matched 0/1 vector and recompute the TCS.
        rng = np.random.default_rng(rng_seed)
        event_sizes = memb_matrix.sum(axis=1).astype(int)
        null_tcs: list[float] = []
        for _ in range(n_permutations):
            shuffled = np.zeros_like(memb_matrix)
            for j, k in enumerate(event_sizes):
                if 0 < k < n:
                    picks = rng.choice(n, size=int(k), replace=False)
                    shuffled[j, picks] = 1.0
            v = self._tcs_from_membership(shuffled, counts_full)
            if v is not None and not np.isnan(v):
                null_tcs.append(v)
        if not null_tcs:
            return observed, None
        null_arr = np.array(null_tcs)
        # +1 smoothing to avoid p=0 with finite permutations
        p = float((np.sum(null_arr >= observed) + 1) / (len(null_arr) + 1))
        return observed, p

    def _tcs_from_membership(
        self,
        memb_matrix: np.ndarray,
        counts_full: np.ndarray,
    ) -> float | None:
        """Mean Kendall tau-b across events, leave-one-out on counts.
        `memb_matrix` is (M events, n outlets) of 0/1."""
        m_events, n = memb_matrix.shape
        n_pairs = n * (n - 1) / 2

        # T_y per event (count-vector ties, after LOO subtraction).
        # Counts shift by -1 for in-event outlets; ties change accordingly.
        # We compute it per event vectorised below.
        taus: list[float] = []
        for j in range(m_events):
            memb = memb_matrix[j]
            memb_sum = memb.sum()
            if memb_sum == 0 or memb_sum == n:
                continue
            counts_loo = counts_full - memb

            # Sign matrix of count differences for this event.
            diff_c = counts_loo[:, None] - counts_loo[None, :]
            sign_c = np.sign(diff_c)

            # 2*(C-D) = sum_{i,j} (m[i] - m[j]) * sign(c[i] - c[j])
            diff_m = memb[:, None] - memb[None, :]
            cd_diff = float((diff_m * sign_c).sum()) / 2.0

            # Tie counts.
            n_pos = float(memb_sum)
            n_neg = n - n_pos
            t_m = (n_pos * (n_pos - 1) + n_neg * (n_neg - 1)) / 2.0
            # Pairs tied in counts_loo (above the diagonal).
            tied_c = (sign_c == 0).sum() - n  # subtract diagonal (always tied with self)
            t_c = tied_c / 2.0

            denom_sq = (n_pairs - t_m) * (n_pairs - t_c)
            if denom_sq <= 0:
                continue
            tau = cd_diff / np.sqrt(denom_sq)
            if not np.isnan(tau):
                taus.append(float(tau))
        if not taus:
            return None
        return float(np.mean(taus))

    def _infer_sequence(
        self,
        outlet_ids: list[str],
        event_sets: list[set[str]],
        skip_counts: dict[str, int],
        min_support: int = 5,
        dom_threshold: float = 0.75,
    ) -> tuple[list[str], str, dict[str, int]]:
        """Outlet A is 'later in route' than B when P(A skipped | B skipped)
        is high but P(B | A) is not — whenever the driver bails before B,
        they've already passed A. The in-degree in this dominance graph
        ranks outlets by 'how far down the route they sit'."""
        n = len(outlet_ids)
        idx = {oid: i for i, oid in enumerate(outlet_ids)}
        memb = np.zeros((len(event_sets), n), dtype=np.int32)
        for j, s in enumerate(event_sets):
            for oid in s:
                if oid in idx:
                    memb[j, idx[oid]] = 1
        counts = memb.sum(axis=0)
        co = memb.T @ memb  # n x n

        in_deg = np.zeros(n, dtype=int)
        for a in range(n):
            for b in range(n):
                if a == b or counts[b] < min_support:
                    continue
                p_a_given_b = co[a, b] / counts[b]
                p_b_given_a = co[a, b] / counts[a] if counts[a] > 0 else 0
                if (
                    p_a_given_b >= dom_threshold
                    and p_b_given_a < dom_threshold
                ):
                    in_deg[a] += 1

        # Highest in_deg = latest in route; break ties by skip count.
        order = sorted(range(n), key=lambda i: (-in_deg[i], -counts[i]))
        seq_ranks = {
            outlet_ids[idx_]: rank + 1 for rank, idx_ in enumerate(order)
        }

        top_k = min(5, max(1, n // 4))
        tail = [outlet_ids[order[r]] for r in range(top_k)]

        max_in_deg = int(in_deg.max()) if n > 0 else 0
        if max_in_deg >= max(n // 3, 3):
            confidence = "high"
        elif max_in_deg >= 2:
            confidence = "medium"
        else:
            confidence = "low"
        return tail, confidence, seq_ranks

    def _empty_response(
        self,
        start_date: date,
        end_date: date,
        notes: list[str],
    ) -> dict:
        return {
            "cohorts": [],
            "universe_size": 0,
            "cohorts_with_signal": 0,
            "skip_detection_window": {
                "start_date": start_date, "end_date": end_date,
            },
            "notes": notes,
        }
