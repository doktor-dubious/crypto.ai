"""Bucketed performance stats for a list of trades, whoever produced them.

Answers questions of the form "does this strategy work better at some times than
others" by bucketing trades on their entry timestamp (hour of day, 4-hour block,
session, weekday) plus a few non-temporal cuts (side, exit reason).

Every bucket carries the sample size alongside the performance number, and a
Welch t of the bucket against all the other trades — with a handful of trades per
hour the spread between hours is almost always noise, and the t is what tells the
two apart. No multiple-comparison correction is applied: testing 24 hours at once
will surface a "significant" one by chance roughly every other analysis, so the
UI shows the caveat and the 4-hour blocks (4× the sample) next to the hours.

Two callers feed this: closed PAPER trades pooled across a template's runs
(``services/paper_trade_analysis.py``) and the trades a BACKTEST just produced on
a strategy's Analytics tab (``services/scalp_analysis.py`` /
``services/swing_analysis.py``). Both express a trade the same way — an entry
time, a fee-inclusive return, a side and an exit reason — so both get the same
statistics and the same caveats.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from crypto_ai.schemas.paper_trade_analysis import (
    AnalysisTrade,
    BucketStat,
    PaperTradeAnalysis,
)

_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
_WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# Non-overlapping UTC trading sessions (crypto trades round the clock, but the
# desks that move it don't). Always UTC — a session means nothing shifted into
# the viewer's local time.
_SESSIONS = [
    ("asia", "Asia (00–08 UTC)", 0, 8),
    ("europe", "Europe (08–16 UTC)", 8, 16),
    ("us", "US (16–24 UTC)", 16, 24),
]

# The response carries the individual trades so the UI can recompute stats for an
# arbitrary hour × weekday × side selection without a round trip. A strategy that
# has traded more than this keeps only its most recent rows — the buckets above
# still cover everything, and the filter is a recency-biased tool anyway.
MAX_TRADE_ROWS = 20_000


@dataclass(slots=True)
class BucketInput:
    """One trade, in the only terms the bucketing needs.

    ``entry_time`` is UTC (the shift is applied here, not by the caller);
    ``ret_bps`` is the fee-inclusive per-trade return in basis points, which is
    capital- and coin-independent so trades pool honestly across coins. ``pnl``
    is quote currency and only comparable within a single run — it is 0.0 for
    backtest trades, which have no capital behind them.
    """

    entry_time: datetime
    ret_bps: float
    side: str
    exit_reason: str | None = None
    pnl: float = 0.0


def build_bucket_analysis(
    trades: Sequence[BucketInput],
    *,
    tz_offset_minutes: int = 0,
    scope: str = "template",
) -> PaperTradeAnalysis:
    """Bucket ``trades`` every which way. Time-of-day buckets are shifted by
    ``tz_offset_minutes`` so the UI can show local time; sessions and weekdays
    stay UTC. Identity fields (template id/name, run counts, coins) are left at
    their defaults for the caller to fill in."""
    empty = PaperTradeAnalysis(
        scope=scope,
        tz_offset_minutes=tz_offset_minutes,
        overall=BucketStat(key="all", label="All trades"),
    )
    if not trades:
        return empty

    shift = timedelta(minutes=tz_offset_minutes)
    # (bucketing timestamp — already shifted, the trade) per row.
    rows: list[tuple[datetime, BucketInput]] = [(t.entry_time + shift, t) for t in trades]
    rows.sort(key=lambda r: r[0])
    all_bps = [t.ret_bps for _, t in rows]

    def bucket(key: str, label: str, members: list[tuple[datetime, BucketInput]]) -> BucketStat:
        return _stat(key, label, members, all_bps)

    by_hour = [
        bucket(str(h), f"{h:02d}:00", [r for r in rows if r[0].hour == h])
        for h in range(24)
    ]
    by_block = [
        bucket(
            f"{b * 4:02d}",
            f"{b * 4:02d}–{b * 4 + 4:02d}",
            [r for r in rows if r[0].hour // 4 == b],
        )
        for b in range(6)
    ]
    # Sessions ignore the viewer's timezone shift — they're UTC by definition.
    by_session = [
        bucket(key, label, [r for r in rows if lo <= (r[0] - shift).hour < hi])
        for key, label, lo, hi in _SESSIONS
    ]
    by_weekday = [
        bucket(
            _WEEKDAYS[d],
            _WEEKDAY_LABELS[d],
            [r for r in rows if (r[0] - shift).weekday() == d],
        )
        for d in range(7)
    ]
    by_side = [
        bucket(side, side, [r for r in rows if r[1].side == side])
        for side in ("long", "short")
    ]
    reasons = sorted({t.exit_reason or "—" for _, t in rows})
    by_exit_reason = [
        bucket(reason, reason, [r for r in rows if (r[1].exit_reason or "—") == reason])
        for reason in reasons
    ]

    return PaperTradeAnalysis(
        scope=scope,
        tz_offset_minutes=tz_offset_minutes,
        n_trades=len(rows),
        first_entry=rows[0][0] - shift,
        last_entry=rows[-1][0] - shift,
        overall=bucket("all", "All trades", rows),
        by_hour=by_hour,
        by_hour_block=by_block,
        by_session=by_session,
        by_weekday=by_weekday,
        by_side=[b for b in by_side if b.n_trades],
        by_exit_reason=by_exit_reason,
        trades=[
            AnalysisTrade(
                entry_time=t.entry_time,
                ret_bps=round(t.ret_bps, 4),
                pnl=round(t.pnl, 6),
                side=t.side,
                exit_reason=t.exit_reason,
            )
            for _, t in rows[-MAX_TRADE_ROWS:]
        ],
        trades_truncated=len(rows) > MAX_TRADE_ROWS,
    )


def bucket_analysis_of(
    sim_trades: Sequence[dict], *, tz_offset_minutes: int = 0
) -> PaperTradeAnalysis:
    """Bucket the trades a BACKTEST produced.

    ``sim_trades`` are the dicts ``SwingAnalysisService._run_trades`` emits —
    ``{timestamp, ret, side, exit_reason, …}`` — shared by the swing and scalp
    explorers. ``ret`` is a fee-inclusive fraction there; there is no capital
    behind a backtest, so every ``pnl`` (and therefore every ``sum_pnl``) is 0.
    """
    return build_bucket_analysis(
        [
            BucketInput(
                entry_time=t["timestamp"],
                ret_bps=float(t["ret"]) * 10_000.0,
                side=str(t["side"]),
                exit_reason=t.get("exit_reason"),
            )
            for t in sim_trades
        ],
        tz_offset_minutes=tz_offset_minutes,
        scope="backtest",
    )


# The trade LIST under the charts is a reading aid, not a dataset: a year-long
# scalp backtest runs to thousands of round-trips, and shipping them all would
# cost more than the analysis itself. The charts and every statistic above still
# cover the whole set — only this list is trimmed.
_MAX_TRADE_ROWS = 25


def build_trade_rows(sim_trades: Sequence[dict]) -> list[dict]:
    """The first _MAX_TRADE_ROWS round-trips, in entry order, as full rows."""
    return [
        {
            "seq": i + 1,
            "side": t["side"],
            "entry_time": t["timestamp"],
            "entry_price": float(t["entry_price"]),
            "exit_time": t["exit_timestamp"],
            "exit_price": float(t["exit_price"]),
            "bars_held": int(t["exit_i"] - t["i"]),
            "ret_bps": round(float(t["ret"]) * 10_000.0, 2),
            "exit_reason": t.get("exit_reason") or "hold_max",
        }
        for i, t in enumerate(sim_trades[:_MAX_TRADE_ROWS])
    ]


def _stat(
    key: str,
    label: str,
    members: Sequence[tuple[datetime, BucketInput]],
    all_bps: list[float],
) -> BucketStat:
    """Performance + significance for one bucket, against ``all_bps`` as the pool."""
    stat = BucketStat(key=key, label=label)
    if not members:
        return stat
    bps = [m[1].ret_bps for m in members]
    stat.n_trades = len(bps)
    stat.n_wins = sum(1 for v in bps if v > 0)
    stat.n_losses = sum(1 for v in bps if v < 0)
    stat.win_rate = stat.n_wins / stat.n_trades
    stat.mean_bps = round(statistics.fmean(bps), 2)
    stat.median_bps = round(statistics.median(bps), 2)
    stat.sum_bps = round(sum(bps), 2)
    stat.sum_pnl = round(sum(m[1].pnl for m in members), 4)

    if len(bps) >= 2:
        sd = statistics.stdev(bps)
        if sd > 0:
            stat.t_stat = round(stat.mean_bps / (sd / math.sqrt(len(bps))), 2)
        # Welch t of this bucket against every trade NOT in it.
        rest = _complement(bps, all_bps)
        if len(rest) >= 2:
            sd_r = statistics.stdev(rest)
            se = math.sqrt(sd**2 / len(bps) + sd_r**2 / len(rest))
            if se > 0:
                stat.t_vs_rest = round((stat.mean_bps - statistics.fmean(rest)) / se, 2)
    return stat


def _complement(bucket_bps: list[float], all_bps: list[float]) -> list[float]:
    """All values minus this bucket's, by multiset difference (duplicate returns
    are common — two trades can close at the same bps — so remove by count)."""
    if len(bucket_bps) >= len(all_bps):
        return []
    counts: dict[float, int] = {}
    for v in bucket_bps:
        counts[v] = counts.get(v, 0) + 1
    rest: list[float] = []
    for v in all_bps:
        if counts.get(v):
            counts[v] -= 1
        else:
            rest.append(v)
    return rest
