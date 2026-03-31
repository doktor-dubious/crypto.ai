"""Analysis service for sales data insights."""

from collections import defaultdict
from datetime import date, timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models import Sales
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_delivery import OutletDelivery
from gorm_ai.database.models.pad import Pad, PadDate
from gorm_ai.database.models.sales_filter import SalesFilter


class AnalysisService:
    """Service for computing sales analysis insights."""

    def __init__(self, session: AsyncSession):
        self.session = session

    # ─── Shared helpers ──────────────────────────────────────────────────────

    async def _fetch_outlet_info(self, outlet_ids: list[str]) -> dict[str, tuple[str, str]]:
        """Return {outlet_id: (ext_id, name)} for given outlets."""
        result = await self.session.execute(
            select(Outlet.id, Outlet.ext_id, Outlet.name).where(Outlet.id.in_(outlet_ids))
        )
        return {r.id: (r.ext_id or "", r.name or "Unknown") for r in result.all()}

    async def _fetch_open_weekdays(self, outlet_ids: list[str]) -> dict[str, set[int]]:
        """Return {outlet_id: set of isoweekdays (1-7) when outlet is open}."""
        result = await self.session.execute(
            select(OutletDelivery.outlet_id, OutletDelivery.weekday).where(
                OutletDelivery.outlet_id.in_(outlet_ids),
                OutletDelivery.open.is_(True),
                OutletDelivery.active.is_(True),
            )
        )
        out: dict[str, set[int]] = defaultdict(set)
        for row in result.all():
            out[row.outlet_id].add(row.weekday)
        return dict(out)

    async def _fetch_sales_raw(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
    ) -> list[tuple]:
        """Fetch raw sales rows: (outlet_id, date, sold, delivered, scan_sold, net_sold)."""
        result = await self.session.execute(
            select(
                Sales.outlet_id, Sales.date, Sales.sold,
                Sales.delivered, Sales.scan_sold, Sales.net_sold,
            ).where(
                Sales.customer_id == customer_id,
                Sales.outlet_id.in_(outlet_ids),
                Sales.date >= start_date,
                Sales.date <= end_date,
                Sales.active.is_(True),
            ).order_by(Sales.outlet_id, Sales.date)
        )
        return list(result.all())

    async def _fetch_sales_filter_dates(
        self, customer_id: str, start_date: date, end_date: date,
    ) -> set[date]:
        """Return set of dates covered by any active SalesFilter."""
        result = await self.session.execute(
            select(SalesFilter.from_date, SalesFilter.to_date).where(
                SalesFilter.customer_id == customer_id,
                SalesFilter.active.is_(True),
                SalesFilter.from_date <= end_date,
                SalesFilter.to_date >= start_date,
            )
        )
        excluded: set[date] = set()
        for row in result.all():
            d = max(row.from_date, start_date)
            end = min(row.to_date, end_date)
            while d <= end:
                excluded.add(d)
                d += timedelta(days=1)
        return excluded

    async def _fetch_pad_dates(self, customer_id: str) -> dict[date, str]:
        """Return {date: pad_name} for all active PADs."""
        result = await self.session.execute(
            select(PadDate.date, Pad.name).join(Pad, PadDate.pad_id == Pad.id).where(
                Pad.customer_id == customer_id,
                Pad.active.is_(True),
                PadDate.active.is_(True),
            )
        )
        out: dict[date, str] = {}
        for row in result.all():
            out[row.date] = row.name
        return out

    # ─── Tab 1: Data Quality ────────────────────────────────────────────────

    async def get_data_quality(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
    ) -> dict:
        outlet_info = await self._fetch_outlet_info(outlet_ids)
        open_weekdays = await self._fetch_open_weekdays(outlet_ids)
        rows = await self._fetch_sales_raw(customer_id, outlet_ids, start_date, end_date)
        filtered_dates = await self._fetch_sales_filter_dates(
            customer_id, start_date, end_date,
        )
        pad_dates = await self._fetch_pad_dates(customer_id)
        pad_date_set = set(pad_dates.keys())

        # Group by outlet, excluding sales-filter dates
        by_outlet: dict[str, list[tuple]] = defaultdict(list)
        for row in rows:
            if row[1] not in filtered_dates:
                by_outlet[row[0]].append(row)

        missing_data = []
        zero_sales = []
        discrepancies_scan: dict[str, list[float]] = defaultdict(list)
        discrepancies_net: dict[str, list[float]] = defaultdict(list)
        scan_counts: dict[str, int] = defaultdict(int)
        net_counts: dict[str, int] = defaultdict(int)
        level_shifts = []
        total_expected_dates = 0
        total_sales_records = 0
        outlets_with_scan: set[str] = set()
        outlets_with_net: set[str] = set()

        for oid in outlet_ids:
            ext_id, name = outlet_info.get(oid, ("", "Unknown"))
            weekdays = open_weekdays.get(oid, set())
            sales_rows = by_outlet.get(oid, [])
            sales_dates = {r[1] for r in sales_rows}

            total_sales_records += len(sales_rows)

            # Missing dates (exclude filtered dates from expected)
            if weekdays:
                expected = set()
                d = start_date
                while d <= end_date:
                    if (d.isoweekday() in weekdays
                            and d not in filtered_dates):
                        expected.add(d)
                    d += timedelta(days=1)
                total_expected_dates += len(expected)
                missing = sorted(expected - sales_dates)
                if missing:
                    missing_data.append({
                        "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                        "missing_dates": missing, "gap_count": len(missing),
                    })

            # Zero-sales on open days (skip low-volume outlets)
            if sales_rows:
                avg_sold = np.mean([r[2] for r in sales_rows])
                if avg_sold > 2:
                    zero_dates = []
                    for r in sales_rows:
                        if r[2] == 0 and r[1].isoweekday() in weekdays:
                            zero_dates.append(r[1])
                    if zero_dates:
                        zero_sales.append({
                            "outlet_id": oid, "outlet_name": name,
                            "ext_id": ext_id,
                            "dates": zero_dates, "count": len(zero_dates),
                        })

            # Field discrepancies
            for r in sales_rows:
                if r[4] is not None:
                    outlets_with_scan.add(oid)
                if r[5] is not None:
                    outlets_with_net.add(oid)
                if r[4] is not None:  # scan_sold
                    diff = abs(r[2] - r[4])
                    if diff > 0:
                        discrepancies_scan[oid].append(diff)
                    scan_counts[oid] = scan_counts.get(oid, 0) + 1
                if r[5] is not None:  # net_sold
                    diff = abs(r[2] - r[5])
                    if diff > 0:
                        discrepancies_net[oid].append(diff)
                    net_counts[oid] = net_counts.get(oid, 0) + 1

            # Level shifts (CUSUM on weekly aggregates, exclude PAD dates)
            non_pad_rows = [r for r in sales_rows if r[1] not in pad_date_set]
            if len(non_pad_rows) >= 60:
                sold_values = np.array([r[2] for r in non_pad_rows], dtype=float)
                dates_list = [r[1] for r in non_pad_rows]
                # Weekly aggregates
                week_sums = []
                week_dates = []
                for i in range(0, len(sold_values) - 6, 7):
                    week_sums.append(np.mean(sold_values[i:i + 7]))
                    week_dates.append(dates_list[min(i + 3, len(dates_list) - 1)])

                if len(week_sums) >= 8:
                    arr = np.array(week_sums)
                    mean = arr.mean()
                    cusum = np.cumsum(arr - mean)
                    std = max(cusum.std(), 1e-6)
                    threshold = 2.5 * std

                    for i in range(2, len(cusum) - 2):
                        if abs(cusum[i]) > threshold:
                            before = float(arr[:i].mean())
                            after = float(arr[i:].mean())
                            change = after - before
                            mag = abs(change)
                            mag_pct = (change / before * 100) if before > 0 else 0
                            if abs(mag_pct) > 20:
                                level_shifts.append({
                                    "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                                    "shift_date": week_dates[i],
                                    "before_mean": round(before, 1),
                                    "after_mean": round(after, 1),
                                    "magnitude": round(mag, 1),
                                    "magnitude_pct": round(mag_pct, 1),
                                })
                            break  # only report first significant shift per outlet

        # Build discrepancy results
        disc_results = []
        for oid, diffs in discrepancies_scan.items():
            if len(diffs) >= 5:
                ext_id, name = outlet_info.get(oid, ("", "Unknown"))
                disc_results.append({
                    "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                    "field": "scan_sold",
                    "avg_difference": round(np.mean(diffs), 1),
                    "occurrence_count": len(diffs),
                    "total_records": scan_counts[oid],
                })
        for oid, diffs in discrepancies_net.items():
            if len(diffs) >= 5:
                ext_id, name = outlet_info.get(oid, ("", "Unknown"))
                disc_results.append({
                    "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                    "field": "net_sold",
                    "avg_difference": round(np.mean(diffs), 1),
                    "occurrence_count": len(diffs),
                    "total_records": net_counts[oid],
                })

        outlets_with_issues = len({
            *(r["outlet_id"] for r in missing_data),
            *(r["outlet_id"] for r in zero_sales),
            *(r["outlet_id"] for r in disc_results),
            *(r["outlet_id"] for r in level_shifts),
        })

        return {
            "missing_data": sorted(missing_data, key=lambda x: x["gap_count"], reverse=True)[:50],
            "zero_sales": sorted(zero_sales, key=lambda x: x["count"], reverse=True)[:50],
            "discrepancies": sorted(
                disc_results, key=lambda x: x["occurrence_count"], reverse=True,
            )[:50],
            "level_shifts": sorted(
                level_shifts, key=lambda x: abs(x["magnitude_pct"]), reverse=True,
            )[:30],
            "summary": {
                "total_missing_dates": sum(r["gap_count"] for r in missing_data),
                "total_zero_sales": sum(r["count"] for r in zero_sales),
                "total_discrepancies": len(disc_results),
                "total_level_shifts": len(level_shifts),
                "outlets_with_issues": outlets_with_issues,
                "total_expected_dates": total_expected_dates,
                "total_sales_records": total_sales_records,
                "total_outlets_with_scan_or_net": len(outlets_with_scan) + len(outlets_with_net),
                "total_outlets_analyzed": len(outlet_ids),
                "total_outlets": len(outlet_ids),
            },
        }

    # ─── Tab 2: Outlier Detection ───────────────────────────────────────────

    async def get_outliers(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
    ) -> dict:
        rows = await self._fetch_sales_raw(customer_id, outlet_ids, start_date, end_date)
        pad_dates = await self._fetch_pad_dates(customer_id)
        filtered_dates = await self._fetch_sales_filter_dates(
            customer_id, start_date, end_date,
        )

        # Aggregate daily across all outlets, excluding filtered dates
        daily_sold: dict[date, int] = defaultdict(int)
        daily_delivered: dict[date, int] = defaultdict(int)
        has_delivered = False
        for r in rows:
            if r[1] in filtered_dates:
                continue
            daily_sold[r[1]] += r[2]
            if r[3] is not None:
                daily_delivered[r[1]] += r[3]
                has_delivered = True

        # Detect outliers using modified z-score (MAD)
        def detect_outliers(daily: dict[date, int], threshold: float = 3.5) -> list[dict]:
            if len(daily) < 14:
                return []
            dates = sorted(daily.keys())
            values = np.array([daily[d] for d in dates], dtype=float)
            median = np.median(values)
            mad = np.median(np.abs(values - median))
            if mad == 0:
                mad = np.std(values) * 0.6745
            if mad == 0:
                return []
            modified_z = 0.6745 * (values - median) / mad
            outliers = []
            for i, d in enumerate(dates):
                if abs(modified_z[i]) > threshold:
                    outliers.append({
                        "date": d,
                        "value": float(values[i]),
                        "expected": float(median),
                        "z_score": round(float(modified_z[i]), 2),
                        "direction": "positive" if modified_z[i] > 0 else "negative",
                        "is_pad_date": d in pad_dates,
                        "pad_name": pad_dates.get(d),
                    })
            return outliers

        def find_recurring(
            daily: dict[date, int], threshold: float = 2.5,
        ) -> tuple[list[dict], list[dict]]:
            outliers = detect_outliers(daily, threshold)
            if not outliers:
                return [], []

            # Group by (month, day) to find recurring
            by_md: dict[tuple[int, int], list[dict]] = defaultdict(list)
            for o in outliers:
                by_md[(o["date"].month, o["date"].day)].append(o)

            recurring = []
            non_recurring = []
            for (m, d_num), items in by_md.items():
                if len(items) >= 2:
                    avg_z = float(np.mean([abs(i["z_score"]) for i in items]))
                    pos = sum(1 for i in items if i["direction"] == "positive")
                    direction = "positive" if pos > len(items) / 2 else "negative"
                    # Check if any date is a registered PAD
                    pad_match = None
                    is_pad = False
                    for i in items:
                        if i["is_pad_date"]:
                            is_pad = True
                            pad_match = i["pad_name"]
                            break
                    recurring.append({
                        "month": m, "day": d_num,
                        "years": sorted([i["date"].year for i in items]),
                        "avg_z_score": round(avg_z, 2),
                        "direction": direction,
                        "is_registered_pad": is_pad,
                        "pad_name": pad_match,
                    })
                else:
                    non_recurring.extend(items)

            return recurring, non_recurring

        rec_sales, nonrec_sales = find_recurring(daily_sold)
        if has_delivered:
            rec_delivery, nonrec_delivery = find_recurring(daily_delivered)
        else:
            rec_delivery, nonrec_delivery = [], []

        def _sort_z(items: list[dict], key: str = "z_score") -> list[dict]:
            return sorted(items, key=lambda x: abs(x[key]), reverse=True)

        return {
            "recurring_sales": _sort_z(rec_sales, "avg_z_score"),
            "non_recurring_sales": _sort_z(nonrec_sales)[:100],
            "recurring_delivery": _sort_z(rec_delivery, "avg_z_score"),
            "non_recurring_delivery": _sort_z(nonrec_delivery)[:100],
        }

    # ─── Tab 3: Patterns & Trends ───────────────────────────────────────────

    async def get_patterns(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
    ) -> dict:
        rows = await self._fetch_sales_raw(customer_id, outlet_ids, start_date, end_date)
        outlet_info = await self._fetch_outlet_info(outlet_ids)
        pad_dates = await self._fetch_pad_dates(customer_id)
        pad_date_set = set(pad_dates.keys())

        # Aggregate daily across all outlets
        daily_sold: dict[date, int] = defaultdict(int)
        per_outlet: dict[str, dict[date, int]] = defaultdict(lambda: defaultdict(int))
        for r in rows:
            daily_sold[r[1]] += r[2]
            per_outlet[r[0]][r[1]] += r[2]

        if len(daily_sold) < 14:
            return self._empty_patterns()

        dates = sorted(daily_sold.keys())
        values = np.array([daily_sold[d] for d in dates], dtype=float)

        # Weekly aggregates for trend
        weekly_dates = []
        weekly_values = []
        d = dates[0]
        while d <= dates[-1]:
            week_end = d + timedelta(days=6)
            week_vals = [daily_sold.get(d + timedelta(days=i), 0) for i in range(7)
                         if (d + timedelta(days=i)) in daily_sold]
            if week_vals:
                weekly_dates.append(d)
                weekly_values.append(sum(week_vals))
            d = week_end + timedelta(days=1)

        weekly_arr = np.array(weekly_values, dtype=float)
        x = np.arange(len(weekly_arr), dtype=float)

        # Linear trend
        if len(x) >= 4:
            coeffs = np.polyfit(x, weekly_arr, 1)
            slope = float(coeffs[0])
            trend_line = np.polyval(coeffs, x)
            ss_res = np.sum((weekly_arr - trend_line) ** 2)
            ss_tot = np.sum((weekly_arr - weekly_arr.mean()) ** 2)
            r_squared = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0

            direction = "flat"
            if abs(slope) > weekly_arr.mean() * 0.005:
                direction = "increasing" if slope > 0 else "decreasing"

            weekly_data = [
                {
                    "date": weekly_dates[i],
                    "value": float(weekly_arr[i]),
                    "trend_value": round(float(trend_line[i]), 1),
                }
                for i in range(len(weekly_arr))
            ]
            trend = {
                "slope": round(slope, 2),
                "slope_per_week": round(slope, 2),
                "direction": direction,
                "r_squared": round(r_squared, 4),
                "weekly_data": weekly_data,
            }
        else:
            trend = {
                "slope": 0, "slope_per_week": 0, "direction": "flat",
                "r_squared": 0, "weekly_data": [],
            }

        # Changepoints (CUSUM on weekly residuals)
        changepoints = []
        if len(weekly_arr) >= 12:
            residuals = weekly_arr - trend_line
            cusum = np.cumsum(residuals - residuals.mean())
            std = max(float(cusum.std()), 1e-6)
            threshold = 2.0 * std
            detected = set()
            for i in range(3, len(cusum) - 3):
                if abs(cusum[i]) > threshold and not any(abs(i - d) < 4 for d in detected):
                    before = float(weekly_arr[:i].mean())
                    after = float(weekly_arr[i:].mean())
                    mag_pct = abs(after - before) / before * 100 if before > 0 else 0
                    if mag_pct > 10:
                        changepoints.append({
                            "date": weekly_dates[i],
                            "before_mean": round(before, 1),
                            "after_mean": round(after, 1),
                            "magnitude_pct": round(mag_pct, 1),
                        })
                        detected.add(i)

        # Seasonality
        weekly_profile = self._compute_weekday_profile(daily_sold)
        has_weekly = False
        weekly_strength = 0.0
        if len(values) >= 14:
            weekday_vals = defaultdict(list)
            for d, v in daily_sold.items():
                weekday_vals[d.isoweekday()].append(v)
            if all(len(v) >= 2 for v in weekday_vals.values()):
                groups = [np.array(weekday_vals[wd]) for wd in sorted(weekday_vals.keys())]
                grand_mean = values.mean()
                ss_between = sum(len(g) * (g.mean() - grand_mean) ** 2 for g in groups)
                ss_total = np.sum((values - grand_mean) ** 2)
                weekly_strength = float(ss_between / ss_total) if ss_total > 0 else 0
                has_weekly = weekly_strength > 0.05

        # Yearly seasonality via STL if enough data
        # Filter out PAD dates so point events don't dominate the
        # seasonal component — we want gradual seasonal curves only.
        has_yearly = False
        yearly_strength = None
        yearly_profile: list[dict] = []

        daily_no_pads = {
            d: v for d, v in daily_sold.items() if d not in pad_date_set
        }
        stl_weekly_dates: list[date] = []
        stl_weekly_values: list[float] = []
        if daily_no_pads:
            stl_dates = sorted(daily_no_pads.keys())
            d = stl_dates[0]
            while d <= stl_dates[-1]:
                week_end = d + timedelta(days=6)
                wv = [
                    daily_no_pads[d + timedelta(days=i)]
                    for i in range(7)
                    if (d + timedelta(days=i)) in daily_no_pads
                ]
                if wv:
                    stl_weekly_dates.append(d)
                    stl_weekly_values.append(float(sum(wv)))
                d = week_end + timedelta(days=1)

        stl_weekly_arr = np.array(stl_weekly_values, dtype=float)
        if len(stl_weekly_arr) >= 104:
            try:
                import pandas as pd
                from statsmodels.tsa.seasonal import STL

                idx = pd.date_range(
                    start=stl_weekly_dates[0],
                    periods=len(stl_weekly_arr), freq="W",
                )
                series = pd.Series(stl_weekly_arr, index=idx)
                stl = STL(series, period=52, robust=True).fit()
                var_resid = np.var(stl.resid)
                var_detrended = np.var(series - stl.trend)
                yearly_strength = (
                    float(1 - var_resid / var_detrended)
                    if var_detrended > 0 else 0
                )
                has_yearly = yearly_strength > 0.1

                # Extract one-year seasonal profile (average across years)
                seasonal = stl.seasonal.values
                n_full_years = len(seasonal) // 52
                if n_full_years >= 1:
                    trimmed = seasonal[:n_full_years * 52]
                    reshaped = trimmed.reshape(n_full_years, 52)
                    avg_profile = reshaped.mean(axis=0)
                    for w in range(52):
                        month = (w * 7 // 30) + 1
                        month = min(month, 12)
                        yearly_profile.append({
                            "week": w + 1,
                            "month": month,
                            "value": round(float(avg_profile[w]), 1),
                        })
            except Exception:
                pass

        seasonality = {
            "has_weekly": has_weekly,
            "has_yearly": has_yearly,
            "weekly_strength": round(weekly_strength, 4),
            "yearly_strength": round(yearly_strength, 4) if yearly_strength is not None else None,
            "weekly_profile": weekly_profile,
            "yearly_profile": yearly_profile,
        }

        # Weekday effects per outlet (top/bottom 20)
        weekday_effects = []
        for oid, outlet_daily in per_outlet.items():
            if len(outlet_daily) < 30:
                continue
            ext_id, name = outlet_info.get(oid, ("", "Unknown"))
            wd_vals: dict[int, list[float]] = defaultdict(list)
            for d, v in outlet_daily.items():
                wd_vals[d.isoweekday()].append(float(v))
            if len(wd_vals) < 5:
                continue
            all_vals = np.array(list(outlet_daily.values()), dtype=float)
            grand_mean = all_vals.mean()
            ss_between = sum(len(v) * (np.mean(v) - grand_mean) ** 2 for v in wd_vals.values())
            ss_within = sum(np.sum((np.array(v) - np.mean(v)) ** 2) for v in wd_vals.values())
            k = len(wd_vals)
            n = len(all_vals)
            denom = ss_within / max(n - k, 1) if ss_within > 0 else 1
            f_stat = (ss_between / max(k - 1, 1)) / denom if ss_within > 0 else 0
            means = [round(float(np.mean(wd_vals.get(wd, [0]))), 1) for wd in range(1, 8)]
            weekday_effects.append({
                "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                "effect_strength": round(float(f_stat), 2),
                "weekday_means": means,
            })
        weekday_effects.sort(key=lambda x: x["effect_strength"], reverse=True)

        # Divergent outlets
        divergent_outlets = []
        if len(weekly_arr) >= 4:
            agg_slope = slope if len(x) >= 4 else 0
            outlet_slopes = []
            for oid, outlet_daily in per_outlet.items():
                if len(outlet_daily) < 30:
                    continue
                # Weekly aggregates for outlet
                o_weekly = []
                d = dates[0]
                while d <= dates[-1]:
                    week_vals = [outlet_daily.get(d + timedelta(days=i), 0) for i in range(7)
                                 if (d + timedelta(days=i)) in outlet_daily]
                    if week_vals:
                        o_weekly.append(sum(week_vals))
                    d += timedelta(days=7)
                if len(o_weekly) >= 4:
                    ox = np.arange(len(o_weekly), dtype=float)
                    o_coeffs = np.polyfit(ox, np.array(o_weekly), 1)
                    outlet_slopes.append((oid, float(o_coeffs[0])))

            if outlet_slopes:
                all_slopes = np.array([s[1] for s in outlet_slopes])
                slope_std = max(float(all_slopes.std()), 1e-6)
                for oid, o_slope in outlet_slopes:
                    divergence = abs(o_slope - agg_slope) / slope_std
                    if divergence > 2.0:
                        ext_id, name = outlet_info.get(oid, ("", "Unknown"))
                        divergent_outlets.append({
                            "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                            "outlet_slope": round(o_slope, 2),
                            "aggregate_slope": round(agg_slope, 2),
                            "divergence": round(float(divergence), 2),
                        })
            divergent_outlets.sort(key=lambda x: x["divergence"], reverse=True)

        return {
            "trend": trend,
            "changepoints": changepoints[:10],
            "seasonality": seasonality,
            "weekday_effects": weekday_effects[:40],
            "divergent_outlets": divergent_outlets[:30],
        }

    def _compute_weekday_profile(self, daily: dict[date, int]) -> list[dict]:
        weekday_vals: dict[int, list[int]] = defaultdict(list)
        for d, v in daily.items():
            weekday_vals[d.isoweekday()].append(v)
        return [
            {"weekday": wd, "avg_value": round(float(np.mean(weekday_vals.get(wd, [0]))), 1)}
            for wd in range(1, 8)
        ]

    def _empty_patterns(self) -> dict:
        return {
            "trend": {
                "slope": 0, "slope_per_week": 0, "direction": "flat",
                "r_squared": 0, "weekly_data": [],
            },
            "changepoints": [],
            "seasonality": {
                "has_weekly": False, "has_yearly": False,
                "weekly_strength": 0, "yearly_strength": None,
                "weekly_profile": [{"weekday": wd, "avg_value": 0} for wd in range(1, 8)],
            },
            "weekday_effects": [],
            "divergent_outlets": [],
        }

    # ─── Tab 4: Delivery Performance ────────────────────────────────────────

    async def get_delivery_performance(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
    ) -> dict:
        rows = await self._fetch_sales_raw(customer_id, outlet_ids, start_date, end_date)
        outlet_info = await self._fetch_outlet_info(outlet_ids)
        filtered_dates = await self._fetch_sales_filter_dates(
            customer_id, start_date, end_date,
        )

        # Per outlet stats
        outlet_stats: dict[str, dict] = defaultdict(lambda: {
            "total_delivered": 0, "total_returned": 0, "days_delivered": 0,
            "sold_out_days": 0, "total_days": 0,
            "sold_values": [], "sold_eq_delivered": 0,
            "weekday_data": defaultdict(
                lambda: {"delivered": 0, "returned": 0, "sold_out": 0, "count": 0},
            ),
        })

        for r in rows:
            if r[1] in filtered_dates:
                continue
            oid, d, sold, delivered = r[0], r[1], r[2], r[3]
            stats = outlet_stats[oid]
            stats["total_days"] += 1
            stats["sold_values"].append(sold)

            if delivered is not None:
                stats["days_delivered"] += 1
                stats["total_delivered"] += delivered
                returned = max(0, delivered - sold)
                stats["total_returned"] += returned
                if sold >= delivered > 0:
                    stats["sold_out_days"] += 1
                if sold == delivered:
                    stats["sold_eq_delivered"] += 1

                wd = d.isoweekday()
                wd_stats = stats["weekday_data"][wd]
                wd_stats["delivered"] += delivered
                wd_stats["returned"] += returned
                if sold >= delivered > 0:
                    wd_stats["sold_out"] += 1
                wd_stats["count"] += 1

        # High return outlets
        high_return = []
        for oid, stats in outlet_stats.items():
            if stats["days_delivered"] < 10 or stats["total_delivered"] == 0:
                continue
            avg_return_pct = stats["total_returned"] / stats["total_delivered"] * 100
            if avg_return_pct > 15:
                ext_id, name = outlet_info.get(oid, ("", "Unknown"))
                high_return.append({
                    "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                    "avg_return_pct": round(avg_return_pct, 1),
                    "days_with_data": stats["days_delivered"],
                })
        high_return.sort(key=lambda x: x["avg_return_pct"], reverse=True)

        # Sold out outlets
        sold_out = []
        for oid, stats in outlet_stats.items():
            if stats["days_delivered"] < 10:
                continue
            sold_out_pct = stats["sold_out_days"] / stats["days_delivered"] * 100
            if sold_out_pct > 10:
                ext_id, name = outlet_info.get(oid, ("", "Unknown"))
                sold_out.append({
                    "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                    "sold_out_pct": round(sold_out_pct, 1),
                    "sold_out_days": stats["sold_out_days"],
                    "total_days": stats["days_delivered"],
                })
        sold_out.sort(key=lambda x: x["sold_out_pct"], reverse=True)

        # Weekday efficiency (top 30 outlets by return rate)
        weekday_efficiency = []
        for oid, stats in outlet_stats.items():
            if stats["days_delivered"] < 14:
                continue
            ext_id, name = outlet_info.get(oid, ("", "Unknown"))
            for wd, wd_stats in stats["weekday_data"].items():
                if wd_stats["count"] < 2:
                    continue
                ret_pct = (
                    wd_stats["returned"] / wd_stats["delivered"] * 100
                    if wd_stats["delivered"] > 0 else None
                )
                so_pct = wd_stats["sold_out"] / wd_stats["count"] * 100
                weekday_efficiency.append({
                    "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                    "weekday": wd,
                    "avg_return_pct": round(ret_pct, 1) if ret_pct is not None else None,
                    "sold_out_pct": round(so_pct, 1),
                    "day_count": wd_stats["count"],
                })

        # Fixed accounts
        fixed_accounts = []
        for oid, stats in outlet_stats.items():
            if stats["total_days"] < 30:
                continue
            sold_arr = np.array(stats["sold_values"], dtype=float)
            mean_sold = float(sold_arr.mean())
            if mean_sold == 0:
                continue
            cv = float(sold_arr.std() / mean_sold)
            eq_pct = (
                stats["sold_eq_delivered"] / stats["days_delivered"] * 100
                if stats["days_delivered"] > 0 else 0
            )
            if cv < 0.05 or eq_pct > 90:
                ext_id, name = outlet_info.get(oid, ("", "Unknown"))
                fixed_accounts.append({
                    "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                    "cv": round(cv, 4),
                    "sold_eq_delivered_pct": round(eq_pct, 1),
                    "avg_sold": round(mean_sold, 1),
                })
        fixed_accounts.sort(key=lambda x: x["cv"])

        return {
            "high_return": high_return[:50],
            "sold_out": sold_out[:50],
            "weekday_efficiency": weekday_efficiency,
            "fixed_accounts": fixed_accounts[:50],
        }

    # ─── Tab 5: Outlet Segmentation ─────────────────────────────────────────

    async def get_segmentation(
        self,
        customer_id: str,
        outlet_ids: list[str],
        start_date: date,
        end_date: date,
    ) -> dict:
        rows = await self._fetch_sales_raw(customer_id, outlet_ids, start_date, end_date)
        outlet_info = await self._fetch_outlet_info(outlet_ids)

        per_outlet: dict[str, dict[date, int]] = defaultdict(lambda: defaultdict(int))
        for r in rows:
            per_outlet[r[0]][r[1]] += r[2]

        # Filter outlets with enough data
        min_days = 30
        valid_outlets = {oid: d for oid, d in per_outlet.items() if len(d) >= min_days}

        # Seasonal clustering (weekday profile)
        seasonal_clusters = []
        profiles: dict[str, np.ndarray] = {}
        for oid, daily in valid_outlets.items():
            wd_sums: dict[int, list[float]] = defaultdict(list)
            for d, v in daily.items():
                wd_sums[d.isoweekday()].append(float(v))
            profile = np.array([np.mean(wd_sums.get(wd, [0])) for wd in range(1, 8)])
            total = profile.sum()
            if total > 0:
                profiles[oid] = profile / total  # normalized
            else:
                profiles[oid] = profile

        if len(profiles) >= 6:
            try:
                from sklearn.cluster import KMeans
                from sklearn.metrics import silhouette_score
                oid_list = list(profiles.keys())
                features = np.array([profiles[oid] for oid in oid_list])

                best_k = 2
                best_score = -1
                max_k = min(8, len(oid_list) // 3)
                for k in range(2, max(max_k + 1, 3)):
                    km = KMeans(n_clusters=k, n_init=10, random_state=42)
                    labels = km.fit_predict(features)
                    if len(set(labels)) < 2:
                        continue
                    score = silhouette_score(features, labels)
                    if score > best_score:
                        best_score = score
                        best_k = k

                km = KMeans(n_clusters=best_k, n_init=10, random_state=42)
                labels = km.fit_predict(features)
                clusters: dict[int, list[str]] = defaultdict(list)
                for i, oid in enumerate(oid_list):
                    clusters[labels[i]].append(oid)

                for cid, members in clusters.items():
                    cluster_profile = np.mean([profiles[oid] for oid in members], axis=0)
                    seasonal_clusters.append({
                        "cluster_id": int(cid),
                        "outlet_ids": members,
                        "outlet_names": [
                            outlet_info.get(oid, ("", "Unknown"))[1]
                            for oid in members
                        ],
                        "cluster_profile": [round(float(v), 4) for v in cluster_profile],
                    })
            except Exception:
                pass

        # Predictability scores
        predictability = []
        for oid, daily in valid_outlets.items():
            values = np.array(list(daily.values()), dtype=float)
            mean_v = values.mean()
            if mean_v == 0:
                continue
            # Detrend
            x = np.arange(len(values), dtype=float)
            coeffs = np.polyfit(x, values, 1)
            detrended = values - np.polyval(coeffs, x)
            cv = float(detrended.std() / mean_v)
            difficulty = "easy" if cv < 0.3 else ("moderate" if cv < 0.6 else "hard")
            ext_id, name = outlet_info.get(oid, ("", "Unknown"))
            predictability.append({
                "outlet_id": oid, "outlet_name": name, "ext_id": ext_id,
                "cv": round(cv, 4), "difficulty": difficulty,
            })
        predictability.sort(key=lambda x: x["cv"], reverse=True)

        # Correlation clusters
        correlation_clusters = []
        # Limit to top 200 outlets by data volume for performance
        sorted_outlets = sorted(valid_outlets.items(), key=lambda x: len(x[1]), reverse=True)[:200]
        if len(sorted_outlets) >= 6:
            try:
                from scipy.cluster.hierarchy import fcluster, linkage
                from scipy.spatial.distance import squareform

                all_dates = sorted(set().union(*(d.keys() for _, d in sorted_outlets)))
                oid_list = [oid for oid, _ in sorted_outlets]
                matrix = np.zeros((len(oid_list), len(all_dates)))
                for i, (oid, daily) in enumerate(sorted_outlets):
                    for j, d in enumerate(all_dates):
                        matrix[i, j] = daily.get(d, 0)

                # Pearson correlation
                corr = np.corrcoef(matrix)
                corr = np.nan_to_num(corr, nan=0.0)
                # Distance = 1 - correlation
                dist = 1 - corr
                np.fill_diagonal(dist, 0)
                dist = np.clip(dist, 0, 2)
                # Make symmetric
                dist = (dist + dist.T) / 2

                condensed = squareform(dist, checks=False)
                linkage_matrix = linkage(condensed, method="average")
                labels = fcluster(linkage_matrix, t=0.7, criterion="distance")

                clusters: dict[int, list[str]] = defaultdict(list)
                for i, oid in enumerate(oid_list):
                    clusters[int(labels[i])].append(oid)

                for cid, members in clusters.items():
                    if len(members) < 2:
                        continue
                    # Avg intra-cluster correlation
                    indices = [oid_list.index(oid) for oid in members]
                    sub_corr = corr[np.ix_(indices, indices)]
                    n = len(indices)
                    if n > 1:
                        avg_corr = float((sub_corr.sum() - n) / (n * (n - 1)))
                    else:
                        avg_corr = 1.0
                    correlation_clusters.append({
                        "cluster_id": cid,
                        "outlet_ids": members,
                        "outlet_names": [
                            outlet_info.get(oid, ("", "Unknown"))[1]
                            for oid in members
                        ],
                        "avg_correlation": round(avg_corr, 4),
                    })
                correlation_clusters.sort(key=lambda x: x["avg_correlation"], reverse=True)
            except Exception:
                pass

        return {
            "seasonal_clusters": seasonal_clusters,
            "predictability": predictability,
            "correlation_clusters": correlation_clusters,
        }
