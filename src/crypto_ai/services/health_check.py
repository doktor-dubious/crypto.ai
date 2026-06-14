"""Customer health check service."""

from datetime import date, timedelta
from difflib import SequenceMatcher

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.customer import Customer
from crypto_ai.database.models.outlet import Outlet
from crypto_ai.prediction.registry import EngineRegistry
from crypto_ai.schemas.health_check import (
    CoverageMetrics,
    DateRange,
    DeadOutlet,
    DuplicateGroup,
    EngineReadiness,
    HealthCheckResponse,
    StructuralFlags,
    ViabilityMetrics,
    VolumeOutlet,
)

DEAD_OUTLET_WEEKS = 8
MIN_HISTORY_DAYS = 60
DUPLICATE_SIMILARITY_THRESHOLD = 0.85
MAX_DEAD_OUTLETS = 50
MAX_VOLUME_OUTLETS = 20
MAX_DUPLICATE_GROUPS = 20


class HealthCheckService:
    """Service for computing customer health check metrics."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def run(
        self, customer_id: str, outlet_ids: list[str] | None = None,
    ) -> HealthCheckResponse | None:
        customer = await self.session.get(Customer, customer_id)
        if not customer or not customer.active:
            return None

        if outlet_ids:
            # Filter to requested outlets only
            result = await self.session.execute(
                select(Outlet).where(
                    Outlet.id.in_(outlet_ids),
                    Outlet.customer_id == customer_id,
                    Outlet.active.is_(True),
                )
            )
            outlets = list(result.scalars().all())
        else:
            outlets = await self._get_active_outlets(customer_id)

        if not outlets:
            return self._empty_report(customer_id, customer.name)

        scoped_ids = [o.id for o in outlets]
        outlet_stats = await self._fetch_outlet_sales_stats(customer_id, scoped_ids)

        coverage = self._compute_coverage(outlets, outlet_stats)
        structural = await self._compute_structural(
            customer_id, outlets, outlet_stats, scoped_ids,
        )
        viability = self._compute_viability(outlets, outlet_stats, coverage)

        return HealthCheckResponse(
            customer_id=customer_id,
            customer_name=customer.name,
            coverage=coverage,
            structural=structural,
            viability=viability,
        )

    # ── Data fetching ──────────────────────────────────────────────────

    async def _get_active_outlets(self, customer_id: str) -> list:
        result = await self.session.execute(
            select(Outlet).where(
                Outlet.customer_id == customer_id,
                Outlet.active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def _fetch_outlet_sales_stats(
        self, customer_id: str, scoped_ids: list[str],
    ) -> dict:
        """Single query: per-outlet min/max date, counts, totals.

        Returns dict keyed by outlet_id (str).
        """
        stmt = text("""
            SELECT
                s.outlet_id,
                min(s.date) AS min_date,
                max(s.date) AS max_date,
                count(*) AS cnt,
                count(s.delivered) AS delivered_cnt,
                count(s.scan_sold) AS scan_sold_cnt,
                count(s.net_sold) AS net_sold_cnt,
                coalesce(sum(s.sold), 0) AS total_sold
            FROM sales s
            WHERE s.customer_id = :cid
              AND s.outlet_id = ANY(:oids)
              AND s.active = true
            GROUP BY s.outlet_id
        """)
        result = await self.session.execute(stmt, {"cid": customer_id, "oids": scoped_ids})
        return {
            str(r.outlet_id): r for r in result.all()
        }

    # ── Coverage metrics ────────────────────────────────────────────────

    def _compute_coverage(self, outlets: list, stats: dict) -> CoverageMetrics:
        today = date.today()
        total_outlets = len(outlets)

        outlets_with_sales = 0
        outlets_with_enough = 0
        history_days_list: list[int] = []
        start_dates: list[date] = []
        total_records = 0
        total_delivered = 0
        total_scan_sold = 0
        total_net_sold = 0
        global_min: date | None = None
        global_max: date | None = None

        for row in stats.values():
            outlets_with_sales += 1
            total_records += row.cnt
            total_delivered += row.delivered_cnt
            total_scan_sold += row.scan_sold_cnt
            total_net_sold += row.net_sold_cnt

            days = (row.max_date - row.min_date).days + 1
            history_days_list.append(days)
            start_dates.append(row.min_date)

            if days >= MIN_HISTORY_DAYS:
                outlets_with_enough += 1

            if global_min is None or row.min_date < global_min:
                global_min = row.min_date
            if global_max is None or row.max_date > global_max:
                global_max = row.max_date

        coverage_ratio = outlets_with_enough / total_outlets if total_outlets else 0.0
        median_days = float(np.median(history_days_list)) if history_days_list else None

        alignment_std: float | None = None
        if len(start_dates) > 1:
            earliest = min(start_dates)
            offsets = [(d - earliest).days for d in start_dates]
            alignment_std = float(np.std(offsets))

        pct_delivered = (total_delivered / total_records * 100) if total_records else 0.0
        pct_scan = (total_scan_sold / total_records * 100) if total_records else 0.0
        pct_net = (total_net_sold / total_records * 100) if total_records else 0.0
        days_since_last = (today - global_max).days if global_max else None

        return CoverageMetrics(
            total_outlets=total_outlets,
            outlets_with_sales=outlets_with_sales,
            outlets_with_enough_history=outlets_with_enough,
            coverage_ratio=round(coverage_ratio, 4),
            min_history_threshold_days=MIN_HISTORY_DAYS,
            date_range=DateRange(
                earliest=global_min.isoformat() if global_min else None,
                latest=global_max.isoformat() if global_max else None,
            ),
            median_history_days=round(median_days, 1) if median_days is not None else None,
            date_alignment_std_days=round(alignment_std, 1) if alignment_std is not None else None,
            pct_records_with_delivered=round(pct_delivered, 2),
            pct_records_with_scan_sold=round(pct_scan, 2),
            pct_records_with_net_sold=round(pct_net, 2),
            total_sales_records=total_records,
            days_since_last_sale=days_since_last,
        )

    # ── Structural flags ────────────────────────────────────────────────

    async def _compute_structural(
        self, customer_id: str, outlets: list, stats: dict,
        scoped_ids: list[str],
    ) -> StructuralFlags:
        dead = self._find_dead_outlets(outlets, stats)
        duplicates = self._find_duplicates(outlets)
        volume = self._compute_volume_distribution(outlets, stats)
        delivery_cov = await self._compute_delivery_coverage(scoped_ids)

        return StructuralFlags(
            dead_outlets=dead,
            dead_outlet_count=len(dead),
            duplicate_groups=duplicates,
            duplicate_group_count=len(duplicates),
            volume_top10_pct=volume["top10_pct"],
            volume_top10_outlets=volume["top_outlets"],
            delivery_config_coverage=delivery_cov["coverage"],
            outlets_with_delivery_config=delivery_cov["with_config"],
            outlets_without_delivery_config=delivery_cov["without_config"],
        )

    def _find_dead_outlets(self, outlets: list, stats: dict) -> list[DeadOutlet]:
        today = date.today()
        cutoff = today - timedelta(weeks=DEAD_OUTLET_WEEKS)

        dead: list[DeadOutlet] = []
        for o in outlets:
            if o.end_date is not None:
                continue
            row = stats.get(o.id)
            last = row.max_date if row else None
            if last is None or last < cutoff:
                days = (today - last).days if last else None
                if days is not None:
                    dead.append(DeadOutlet(
                        outlet_id=o.id,
                        ext_id=o.ext_id or "",
                        name=o.name or "Unknown",
                        last_sale_date=last.isoformat(),
                        days_since_last_sale=days,
                    ))
        dead.sort(key=lambda d: d.days_since_last_sale, reverse=True)
        return dead[:MAX_DEAD_OUTLETS]

    def _find_duplicates(self, outlets: list) -> list[DuplicateGroup]:
        # Only check outlets with names (skip unnamed)
        named = [o for o in outlets if o.name and o.name.strip()]
        # Sort by name for faster grouping
        named.sort(key=lambda o: (o.name or "").lower().strip())

        groups: list[DuplicateGroup] = []
        seen: set[str] = set()

        for i, a in enumerate(named):
            if a.id in seen or len(groups) >= MAX_DUPLICATE_GROUPS:
                break
            name_a = (a.name or "").lower().strip()
            group_ids = [a.id]
            group_names = [a.name or ""]
            group_addrs = [a.address]

            # Only check nearby outlets in sorted order (duplicates
            # will be alphabetically close)
            for b in named[i + 1: i + 20]:
                if b.id in seen:
                    continue
                name_b = (b.name or "").lower().strip()

                # Quick length check before expensive SequenceMatcher
                if abs(len(name_a) - len(name_b)) > max(len(name_a), len(name_b)) * 0.3:
                    continue

                sim = SequenceMatcher(None, name_a, name_b).ratio()

                if a.address and b.address:
                    addr_sim = SequenceMatcher(
                        None, a.address.lower().strip(), b.address.lower().strip(),
                    ).ratio()
                    sim = max(sim, addr_sim)

                if sim >= DUPLICATE_SIMILARITY_THRESHOLD:
                    group_ids.append(b.id)
                    group_names.append(b.name or "")
                    group_addrs.append(b.address)
                    seen.add(b.id)

            if len(group_ids) > 1:
                seen.add(a.id)
                groups.append(DuplicateGroup(
                    outlet_ids=group_ids,
                    names=group_names,
                    addresses=group_addrs,
                ))

        return groups

    def _compute_volume_distribution(
        self, outlets: list, stats: dict,
    ) -> dict:
        # Build sorted list from stats
        volumes = []
        for o in outlets:
            row = stats.get(o.id)
            total = row.total_sold if row else 0
            if total > 0:
                volumes.append((o, total))
        volumes.sort(key=lambda x: x[1], reverse=True)

        if not volumes:
            return {"top10_pct": 0.0, "top_outlets": []}

        grand_total = sum(v for _, v in volumes)
        if grand_total == 0:
            return {"top10_pct": 0.0, "top_outlets": []}

        top_n = max(len(volumes) // 10, 1)
        top = volumes[:top_n]
        top_total = sum(v for _, v in top)
        top10_pct = round(top_total / grand_total * 100, 2)

        top_outlets = []
        for o, vol in top[:MAX_VOLUME_OUTLETS]:
            top_outlets.append(VolumeOutlet(
                outlet_id=o.id,
                ext_id=o.ext_id or "",
                name=o.name or "Unknown",
                total_sold=vol,
                pct_of_total=round(vol / grand_total * 100, 2),
            ))

        return {"top10_pct": top10_pct, "top_outlets": top_outlets}

    async def _compute_delivery_coverage(
        self, scoped_ids: list[str],
    ) -> dict:
        stmt = text("""
            SELECT count(DISTINCT od.outlet_id)
            FROM outlet_deliveries od
            WHERE od.outlet_id = ANY(:oids)
              AND od.active = true
        """)
        result = await self.session.execute(stmt, {"oids": scoped_ids})
        total_outlets = len(scoped_ids)
        with_config = result.scalar() or 0
        without_config = total_outlets - with_config
        coverage = round(with_config / total_outlets * 100, 2) if total_outlets else 0.0

        return {
            "coverage": coverage,
            "with_config": with_config,
            "without_config": without_config,
        }

    # ── Viability metrics ───────────────────────────────────────────────

    def _compute_viability(
        self, outlets: list, stats: dict, coverage: CoverageMetrics,
    ) -> ViabilityMetrics:
        engine_readiness = self._compute_engine_readiness(outlets, stats)
        agg_cv = self._compute_aggregate_cv(stats)
        status = self._determine_status(coverage, engine_readiness, agg_cv)

        return ViabilityMetrics(
            engine_readiness=engine_readiness,
            aggregate_cv=agg_cv,
            overall_status=status,
        )

    def _compute_engine_readiness(
        self, outlets: list, stats: dict,
    ) -> list[EngineReadiness]:
        outlet_days: list[int] = []
        for o in outlets:
            row = stats.get(o.id)
            if row:
                days = (row.max_date - row.min_date).days + 1
                outlet_days.append(days)

        total = len(outlets)
        registry = EngineRegistry()
        readiness: list[EngineReadiness] = []

        for engine_enum in registry.get_available_engines():
            caps = registry.get_capabilities(engine_enum)
            qualifying = sum(
                1 for d in outlet_days if d >= caps.min_history_length
            )
            readiness.append(EngineReadiness(
                engine=engine_enum.value,
                min_history=caps.min_history_length,
                qualifying_outlets=qualifying,
                total_outlets=total,
                pct_qualifying=round(qualifying / total * 100, 2) if total else 0.0,
            ))

        readiness.sort(key=lambda r: r.pct_qualifying, reverse=True)
        return readiness

    def _compute_aggregate_cv(self, stats: dict) -> float | None:
        """Approximate aggregate CV from per-outlet totals and counts."""
        if len(stats) < 2:
            return None

        # Use per-outlet average daily volume as a proxy
        daily_avgs = []
        for row in stats.values():
            if row.cnt > 0:
                daily_avgs.append(row.total_sold / row.cnt)

        if len(daily_avgs) < 2:
            return None

        arr = np.array(daily_avgs, dtype=float)
        mean = arr.mean()
        if mean == 0:
            return None
        return round(float(arr.std() / mean), 4)

    def _determine_status(
        self,
        coverage: CoverageMetrics,
        engine_readiness: list[EngineReadiness],
        agg_cv: float | None,
    ) -> str:
        if coverage.total_sales_records == 0:
            return "no_data"
        if coverage.coverage_ratio < 0.1:
            return "critical"
        if coverage.coverage_ratio < 0.5:
            return "warning"

        any_engine_viable = any(r.pct_qualifying >= 50 for r in engine_readiness)
        if not any_engine_viable:
            return "warning"

        if agg_cv is not None and agg_cv > 2.0:
            return "warning"

        return "healthy"

    # ── Empty report ────────────────────────────────────────────────────

    def _empty_report(
        self, customer_id: str, customer_name: str,
    ) -> HealthCheckResponse:
        return HealthCheckResponse(
            customer_id=customer_id,
            customer_name=customer_name,
            coverage=CoverageMetrics(
                total_outlets=0,
                outlets_with_sales=0,
                outlets_with_enough_history=0,
                coverage_ratio=0.0,
                min_history_threshold_days=MIN_HISTORY_DAYS,
                date_range=DateRange(),
                pct_records_with_delivered=0.0,
                pct_records_with_scan_sold=0.0,
                pct_records_with_net_sold=0.0,
                total_sales_records=0,
            ),
            structural=StructuralFlags(
                dead_outlets=[],
                dead_outlet_count=0,
                duplicate_groups=[],
                duplicate_group_count=0,
                volume_top10_pct=0.0,
                volume_top10_outlets=[],
                delivery_config_coverage=0.0,
                outlets_with_delivery_config=0,
                outlets_without_delivery_config=0,
            ),
            viability=ViabilityMetrics(
                engine_readiness=[],
                overall_status="no_data",
            ),
        )
