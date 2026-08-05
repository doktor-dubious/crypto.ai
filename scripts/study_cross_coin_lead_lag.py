"""Cross-coin lead-lag study: does BTC lead the alts, and does removing BTC's
move from an alt's returns sharpen the streak-reversion edge?

Read-only against the existing `klines` table — no models, no migrations, no
services. Run it, read the report, throw it away if the answer is no.

Two questions, in the order they should be asked:

  Part A — is there a LEAD at all?
      corr(alt[t], btc[t-1]) per coin, against the contemporaneous corr and
      against the reverse direction (alt leading BTC) as a control. The
      prediction worth testing is not "the lead exists" but "the lead grows as
      the alt gets less liquid" — thin books are the mechanism, so the effect
      must show a liquidity gradient or it isn't the effect.

  Part B — does the BETA DECOMPOSITION sharpen streak reversion?
      Split each alt return into beta*btc + residual (causal rolling beta).
      A same-direction streak that BTC explains is a repricing (should not
      revert); a streak that lives in the residual is thin-book overreaction
      (should revert harder). Part B measures both against the raw-streak
      baseline the project already established.

SIGNIFICANCE. Pooling millions of overlapping, cross-correlated bar events
produces t-stats in the hundreds that mean nothing — every coin is reacting to
the same BTC tape, so the observations are nowhere near independent. Every
headline number here is therefore also reported as a MONTHLY-BLOCK t: average
the statistic within each calendar month, then t-test across the ~12 months.
That is the number to believe. The pooled t is printed next to it only to show
how far apart the two are.

BID-ASK BOUNCE is the trap that kills naive reversion studies. Close-to-close
returns in a thin book alternate between trades at the bid and at the ask, which
manufactures negative autocorrelation — a "reversion" you cannot trade, because
you buy at the ask and sell at the bid. Two controls run against it:

  * every Part B number is also broken out by LIQUIDITY TERCILE. Bounce is a
    thin-book artifact, so an edge that only exists in the thinnest coins is
    almost certainly spread, not signal.
  * every variant has a SKIP-1 twin that enters one bar later. Bounce reverses
    within a bar or two; genuine overreaction decays more slowly. If skip-1
    kills the edge, it was the spread.

Costs: the project's paper engine defaults to 8 bps round-trip, so a gross
reversion edge below ~8 bps is not tradeable as-is, however significant — and
that is before the half-spread, which on the thinnest coins here exceeds the
whole effect.

READING THE HIT RATES: ~29% of 5m alt bars close exactly unchanged (tick
quantization on cheap coins). An unchanged bar counts as "did not revert", so
every `reversion_rate` here is mechanically deflated — a raw rate of 0.47 is not
"worse than a coin flip". Compare rates only against each other, never against
0.5, and treat `mean_bps` as the decision-relevant number. The one exception is
`resid_pure`, whose outcome is a residual and so is almost never exactly zero —
which is most of why its rate looks so much healthier than its siblings'.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import UTC, datetime

import asyncpg
import numpy as np
import pandas as pd

# ── Study window / universe ──────────────────────────────────────────────────
DSN = os.environ.get(
    "STUDY_DSN", "postgresql://gorm:gorm@localhost:5433/crypto_ai"
)
INTERVAL = os.environ.get("STUDY_INTERVAL", "5m")
QUOTE = "USDT"
_BAR_MINUTES = {"5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}
if INTERVAL not in _BAR_MINUTES:
    raise SystemExit(f"unsupported STUDY_INTERVAL: {INTERVAL}")
BAR_SECONDS = _BAR_MINUTES[INTERVAL] * 60
START = datetime(2025, 8, 1, tzinfo=UTC)
END = datetime(2026, 8, 1, tzinfo=UTC)
BTC_SYMBOL = "BTC"
# A coin needs 85% of the window's bars to enter the study. Derived from the
# interval so the bar rather than the wall-clock coverage stays constant when the
# study is re-run at 15m or 1h.
BARS_PER_WINDOW = int((END - START).total_seconds() // BAR_SECONDS)
MIN_BARS = int(0.85 * BARS_PER_WINDOW)
# Bars a coin-month needs before its correlation joins the monthly-block test.
# Scaled to the interval: a fixed 1000 silently emptied the whole block test at
# 1h, where a month holds only ~730 bars.
MIN_MONTH_OBS = max(100, int(0.4 * BARS_PER_WINDOW / 12))
# Drop coins with nothing to predict: median absolute 5m move below this. Catches
# both stablecoins and tick-quantized/stale books (BTTC at 3e-7, MTL at ~7 trades
# per bar) where most bars print an unchanged close. Data-driven, so no
# hand-maintained symbol list — but note it is a staleness filter, not a
# "stablecoin" filter, and most of what it removes is the latter kind.
MIN_MEDIAN_ABS_BPS = 1.0

# Causal beta: EWMA half-life of one day's worth of bars, shifted one bar so
# bar t's beta never sees bar t. Expressed in days so the estimator means the
# same thing at 5m (288 bars) as at 1h (24 bars).
BETA_HALFLIFE = max(8, int(24 * 60 / _BAR_MINUTES[INTERVAL]))
# Streak lengths to test (matching the streak strategy's `threshold` knob).
STREAK_KS = (3, 4, 5)
# Share of a streak's total move attributable to beta*BTC above which the streak
# counts as "BTC-driven" rather than idiosyncratic.
BTC_DRIVEN_SHARE = 0.5

OUT_DIR = os.environ.get("STUDY_OUT", "/tmp/cross_coin_study")
# Smoke-test escape hatch: analyse only the first N coins.
LIMIT = int(os.environ.get("STUDY_LIMIT", "0")) or None


# ── Grid helpers ─────────────────────────────────────────────────────────────

N_SLOTS = int((END - START).total_seconds() // BAR_SECONDS)


def to_grid(times: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Scatter (time, value) onto the fixed 5m grid, NaN where a bar is missing.

    Working on one shared grid makes every cross-coin alignment an array index
    and makes gaps explicit: a return is only computed where both the bar and
    its predecessor exist, so an import hole can never silently splice two
    non-adjacent bars into a "return".
    """
    out = np.full(N_SLOTS, np.nan)
    idx = ((times - START.timestamp()) // BAR_SECONDS).astype(np.int64)
    ok = (idx >= 0) & (idx < N_SLOTS)
    out[idx[ok]] = values[ok]
    return out


def log_returns(prices: np.ndarray) -> np.ndarray:
    """Bar-to-bar log returns on the grid; NaN wherever either bar is missing."""
    r = np.full_like(prices, np.nan)
    r[1:] = np.log(prices[1:] / prices[:-1])
    return r


def corr_t(x: np.ndarray, y: np.ndarray) -> tuple[float | None, float | None, int]:
    """Pearson r and its t on the pairwise-complete overlap."""
    m = np.isfinite(x) & np.isfinite(y)
    n = int(m.sum())
    if n < 100:
        return None, None, n
    xs, ys = x[m], y[m]
    sx, sy = xs.std(), ys.std()
    if sx == 0 or sy == 0:
        return None, None, n
    r = float(((xs - xs.mean()) * (ys - ys.mean())).mean() / (sx * sy))
    r = max(min(r, 0.999999), -0.999999)
    t = r * np.sqrt((n - 2) / (1 - r * r))
    return r, float(t), n


def shift(a: np.ndarray, k: int) -> np.ndarray:
    """a shifted forward k bars: out[t] = a[t-k] (NaN-filled at the head)."""
    out = np.full_like(a, np.nan)
    if k > 0:
        out[k:] = a[:-k]
    elif k < 0:
        out[:k] = a[-k:]
    else:
        out[:] = a
    return out


def signed_streaks(r: np.ndarray) -> np.ndarray:
    """Signed run length ending at each bar (+k after k ups, -k after k downs).

    Same definition as the project's streak_reversal engine, vectorised. NaN
    bars (missing data) get sign 0 and break the run, so a gap can never be
    absorbed into the middle of a streak.
    """
    s = np.sign(np.nan_to_num(r, nan=0.0)).astype(np.int64)
    n = len(s)
    if n == 0:
        return s
    new_run = np.empty(n, dtype=bool)
    new_run[0] = True
    new_run[1:] = s[1:] != s[:-1]
    group = np.cumsum(new_run) - 1
    starts = np.flatnonzero(new_run)
    pos = np.arange(n) - starts[group] + 1
    return pos * s


def month_agg(vals: np.ndarray, month_idx: np.ndarray, n_months: int) -> np.ndarray:
    """Per-month (count, sum, sum of squares, wins) for one coin's events.

    Events are folded into monthly sufficient statistics rather than kept — the
    full study generates tens of millions of them, and everything downstream
    (pooled mean, pooled t, block t, tercile splits) is recoverable from these
    four numbers per month.
    """
    out = np.zeros((4, n_months))
    out[0] = np.bincount(month_idx, minlength=n_months)
    out[1] = np.bincount(month_idx, weights=vals, minlength=n_months)
    out[2] = np.bincount(month_idx, weights=vals * vals, minlength=n_months)
    out[3] = np.bincount(month_idx, weights=(vals > 0).astype(float), minlength=n_months)
    return out


def stats_from_monthly(acc: np.ndarray) -> dict:
    """Pooled and monthly-block statistics from summed monthly sufficient stats.

    `block_t` is the number to believe: bar-level events overlap and share a
    common tape, so `pooled_t_INFLATED` overstates significance by a large and
    unknowable factor. It is reported only to show the size of that gap.
    """
    n_tot = float(acc[0].sum())
    if n_tot < 100:
        return {"n_events": int(n_tot)}
    s_tot, ss_tot, w_tot = float(acc[1].sum()), float(acc[2].sum()), float(acc[3].sum())
    mean = s_tot / n_tot
    var = max(ss_tot / n_tot - mean * mean, 0.0)
    sd = np.sqrt(var)
    out = {
        "n_events": int(n_tot),
        "mean_bps": round(mean, 3),
        "reversion_rate": round(w_tot / n_tot, 4),
        "pooled_t_INFLATED": round(mean / (sd / np.sqrt(n_tot)), 1) if sd > 0 else None,
    }
    live = acc[0] > 0
    per_month = acc[1][live] / acc[0][live]
    out["n_months"] = int(live.sum())
    if len(per_month) >= 3:
        out["block_mean"] = round(float(per_month.mean()), 3)
        out["months_positive"] = int((per_month > 0).sum())
        msd = per_month.std(ddof=1)
        out["block_t"] = (
            round(float(per_month.mean() / (msd / np.sqrt(len(per_month)))), 2)
            if msd > 0 else None
        )
    return out


# ── Data loading ─────────────────────────────────────────────────────────────


async def eligible_coins(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        SELECT c.id, c.symbol, count(*) AS bars
        FROM klines k JOIN coin c ON c.id = k.coin_id
        WHERE k.interval = $1 AND k.quote_asset = $2
          AND k.open_time >= $3 AND k.open_time < $4
        GROUP BY c.id, c.symbol
        HAVING count(*) >= $5
        ORDER BY c.symbol
        """,
        INTERVAL, QUOTE, START, END, MIN_BARS,
    )


async def load_series(conn: asyncpg.Connection, coin_id: str) -> tuple[np.ndarray, np.ndarray]:
    """(close, quote_volume) on the shared grid for one coin."""
    rows = await conn.fetch(
        """
        SELECT extract(epoch FROM open_time)::float8 AS ts,
               close::float8 AS close,
               quote_asset_volume::float8 AS qv
        FROM klines
        WHERE coin_id = $1 AND interval = $2 AND quote_asset = $3
          AND open_time >= $4 AND open_time < $5
        ORDER BY open_time
        """,
        coin_id, INTERVAL, QUOTE, START, END,
    )
    if not rows:
        return np.full(N_SLOTS, np.nan), np.full(N_SLOTS, np.nan)
    ts = np.fromiter((r["ts"] for r in rows), dtype=np.float64, count=len(rows))
    close = np.fromiter((r["close"] for r in rows), dtype=np.float64, count=len(rows))
    qv = np.fromiter((r["qv"] for r in rows), dtype=np.float64, count=len(rows))
    return to_grid(ts, close), to_grid(ts, qv)


# ── Part B: streak events ────────────────────────────────────────────────────


def streak_events(
    r_alt: np.ndarray,
    r_btc: np.ndarray,
    beta: np.ndarray,
    resid: np.ndarray,
    months: np.ndarray,
    k: int,
) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Reversion outcomes after k-bar streaks, in bps, as (values, months) pairs.

    A "reversion return" is the next bar's move signed AGAINST the streak, so a
    positive mean means the streak reverted — the sign convention a reversion
    strategy trades on, gross of fees.

    Variants:
      raw          — streak on the alt's own returns (the existing baseline)
      raw_btc      — those streaks that BTC's move explains (repricing)
      raw_idio     — those streaks that live in the residual (overreaction)
      resid_streak — streak on the residual, outcome measured on the raw return
                     (this is what a residual-based strategy would actually trade)
      resid_pure   — streak on the residual, outcome measured on the residual
                     (the effect with market risk stripped out of the outcome too)

    Each variant also gets a `_skip1` twin whose outcome is the bar AFTER next.
    Bid-ask bounce lives in the immediately following bar; a real overreaction
    should still be unwinding one bar later. The gap between a variant and its
    skip-1 twin is the study's cleanest read on how much of the edge is spread.
    """
    out: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    beta_comp = beta * r_btc  # the part of the alt's move BTC explains

    def rolling_sum(a: np.ndarray, w: int) -> np.ndarray:
        """Trailing w-bar sum ending at each bar (NaN if any bar in it is NaN)."""
        return pd.Series(a).rolling(w).sum().to_numpy()

    def emit(name: str, rev: np.ndarray, sel: np.ndarray) -> None:
        ok = sel & np.isfinite(rev)
        out[name] = (rev[ok], months[ok])

    for name, streak_src, outcome in (
        ("raw", r_alt, r_alt),
        ("resid_streak", resid, r_alt),
        ("resid_pure", resid, resid),
    ):
        st = signed_streaks(streak_src)
        direction = np.sign(st)
        is_event = np.abs(st) >= k
        # Outcome signed AGAINST the streak: next bar, and the one after it.
        nxt = shift(outcome, -1)
        nxt2 = shift(outcome, -2)
        rev = -direction * nxt * 1e4  # bps
        rev_skip = -direction * nxt2 * 1e4
        emit(name, rev, is_event)
        emit(f"{name}_skip1", rev_skip, is_event)

        if name != "raw":
            continue
        # Split the raw streaks by what drove them: over the k bars of the
        # streak, how much of the total move is beta*BTC?
        total = rolling_sum(r_alt, k)
        driven = rolling_sum(beta_comp, k)
        with np.errstate(divide="ignore", invalid="ignore"):
            share = np.where(np.abs(total) > 0, driven / total, np.nan)
        btc_driven = is_event & np.isfinite(share) & (share >= BTC_DRIVEN_SHARE)
        idio = is_event & np.isfinite(share) & (share < BTC_DRIVEN_SHARE)
        emit("raw_btc", rev, btc_driven)
        emit("raw_idio", rev, idio)
        emit("raw_idio_skip1", rev_skip, idio)
    return out


# ── Main ─────────────────────────────────────────────────────────────────────


async def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = await asyncpg.connect(DSN)
    try:
        coins = await eligible_coins(conn)
        btc = next((c for c in coins if c["symbol"] == BTC_SYMBOL), None)
        if btc is None:
            raise SystemExit(f"{BTC_SYMBOL} has no {INTERVAL} coverage in the window")
        if LIMIT:
            coins = [c for c in coins if c["symbol"] != BTC_SYMBOL][:LIMIT]
        print(f"universe: {len(coins)} coins with >= {MIN_BARS} bars", flush=True)

        btc_close, _ = await load_series(conn, btc["id"])
        r_btc = log_returns(btc_close)
        # Calendar month of each grid slot, as a 0-based index for the block
        # tests (integer codes keep the per-event arrays numeric).
        slot_times = pd.to_datetime(
            START.timestamp() + np.arange(N_SLOTS) * BAR_SECONDS, unit="s", utc=True
        )
        month_code = (slot_times.year * 12 + slot_times.month).to_numpy()
        month_idx = (month_code - month_code.min()).astype(np.int64)
        n_months = int(month_idx.max()) + 1
        month_labels = [
            str(p) for p in pd.period_range(
                slot_times[0].to_period("M"), slot_times[-1].to_period("M"), freq="M"
            )
        ]

        per_coin: list[dict] = []
        # Streak outcomes folded to monthly sufficient statistics, per variant
        # and per coin (the coin's liquidity drives the tercile split later).
        pooled: dict[tuple[str, int], list[tuple[float, np.ndarray]]] = {}
        dropped: list[str] = []

        for i, coin in enumerate(coins, 1):
            if coin["symbol"] == BTC_SYMBOL:
                continue
            close, qv = await load_series(conn, coin["id"])
            r_alt = log_returns(close)
            fin = np.isfinite(r_alt)
            if fin.sum() < MIN_BARS // 2:
                dropped.append(f"{coin['symbol']} (too few returns)")
                continue
            med_abs_bps = float(np.median(np.abs(r_alt[fin])) * 1e4)
            if med_abs_bps < MIN_MEDIAN_ABS_BPS:
                dropped.append(f"{coin['symbol']} (stable, {med_abs_bps:.2f} bps)")
                continue

            # ── Part A: lead-lag ──
            c0, t0, n0 = corr_t(r_alt, r_btc)
            l1, tl1, _ = corr_t(r_alt, shift(r_btc, 1))
            l2, tl2, _ = corr_t(r_alt, shift(r_btc, 2))
            l3, _, _ = corr_t(r_alt, shift(r_btc, 3))
            rev1, trev1, _ = corr_t(r_btc, shift(r_alt, 1))  # control: alt leads BTC
            ar1, tar1, _ = corr_t(r_alt, shift(r_alt, 1))  # own reversion, in corr form

            # Per-month lead corr, so the pooled claim gets a block test.
            lead_by_month: dict[str, float] = {}
            lagged_btc = shift(r_btc, 1)
            for mi in range(n_months):
                sel = month_idx == mi
                rm, _, nm = corr_t(r_alt[sel], lagged_btc[sel])
                if rm is not None and nm >= MIN_MONTH_OBS:
                    lead_by_month[month_labels[mi]] = rm

            # ── Part B: beta decomposition ──
            # Causal EWMA beta = cov(alt, btc) / var(btc), shifted one bar so the
            # beta applied at t was estimable at t-1.
            both = np.isfinite(r_alt) & np.isfinite(r_btc)
            a = np.where(both, r_alt, np.nan)
            b = np.where(both, r_btc, np.nan)
            cov = pd.Series(a * b).ewm(halflife=BETA_HALFLIFE, min_periods=BETA_HALFLIFE).mean()
            var = pd.Series(b * b).ewm(halflife=BETA_HALFLIFE, min_periods=BETA_HALFLIFE).mean()
            beta = (cov / var).shift(1).to_numpy()
            beta = np.clip(beta, -5.0, 5.0)  # a blown-up beta is an estimate failure
            resid = r_alt - beta * r_btc

            liquidity = float(np.nanmedian(qv))
            for k in STREAK_KS:
                for name, (vals, mons) in streak_events(
                    r_alt, r_btc, beta, resid, month_idx, k
                ).items():
                    if len(vals):
                        pooled.setdefault((name, k), []).append(
                            (liquidity, month_agg(vals, mons, n_months))
                        )

            fin_b = np.isfinite(beta)
            per_coin.append({
                "symbol": coin["symbol"],
                "n_returns": int(fin.sum()),
                "median_quote_vol": liquidity,
                "median_abs_bps": round(med_abs_bps, 2),
                "corr_contemp": c0, "t_contemp": t0, "n_overlap": n0,
                "lead1": l1, "t_lead1": tl1,
                "lead2": l2, "t_lead2": tl2,
                "lead3": l3,
                "reverse_lead1": rev1, "t_reverse_lead1": trev1,
                "ar1": ar1, "t_ar1": tar1,
                "beta_median": float(np.nanmedian(beta[fin_b])) if fin_b.any() else None,
                "lead_by_month": lead_by_month,
            })
            if i % 25 == 0:
                print(f"  {i}/{len(coins)} … {coin['symbol']}", flush=True)

        # ── Aggregate ──
        report = {
            "window": {"start": START.isoformat(), "end": END.isoformat(),
                       "interval": INTERVAL, "quote": QUOTE},
            "universe": {"eligible": len(coins), "analysed": len(per_coin),
                         "dropped": dropped},
            "part_a": aggregate_lead(per_coin),
            "part_b": aggregate_streaks(pooled),
            "per_coin": per_coin,
        }
        path = os.path.join(OUT_DIR, "cross_coin_study.json")
        with open(path, "w") as fh:
            json.dump(report, fh, indent=2, default=str)
        print(f"\nwrote {path}", flush=True)
        print_summary(report)
    finally:
        await conn.close()


def aggregate_lead(per_coin: list[dict]) -> dict:
    """Cross-sectional summary of the lead, plus the liquidity-gradient test."""
    lead = np.array([c["lead1"] for c in per_coin if c["lead1"] is not None])
    contemp = np.array([c["corr_contemp"] for c in per_coin if c["corr_contemp"] is not None])
    reverse = np.array([c["reverse_lead1"] for c in per_coin if c["reverse_lead1"] is not None])
    ar1 = np.array([c["ar1"] for c in per_coin if c["ar1"] is not None])
    tl = np.array([c["t_lead1"] for c in per_coin if c["t_lead1"] is not None])

    # Block test on the lead: mean lead corr across coins within each month,
    # then t across months.
    month_means: dict[str, list[float]] = {}
    for c in per_coin:
        for month, v in c["lead_by_month"].items():
            month_means.setdefault(month, []).append(v)
    per_month = {m: float(np.mean(v)) for m, v in sorted(month_means.items())}
    vals = np.array(list(per_month.values()))
    block = {
        "n_months": len(vals),
        "mean": float(vals.mean()) if len(vals) else None,
        "t": float(vals.mean() / (vals.std(ddof=1) / np.sqrt(len(vals))))
        if len(vals) >= 3 and vals.std(ddof=1) > 0 else None,
        "months_positive": int((vals > 0).sum()),
        "by_month": per_month,
    }

    # Liquidity gradient: the mechanism (thin books absorb BTC's move slowly)
    # predicts the lead is STRONGER for less liquid coins. Deciles by median
    # quote volume, decile 1 = thinnest.
    liq = np.array([c["median_quote_vol"] for c in per_coin])
    leads = np.array([c["lead1"] if c["lead1"] is not None else np.nan for c in per_coin])
    order = np.argsort(liq)
    deciles = []
    for d in range(10):
        lo, hi = int(d * len(order) / 10), int((d + 1) * len(order) / 10)
        sel = order[lo:hi]
        if not len(sel):
            continue
        deciles.append({
            "decile": d + 1,
            "n_coins": len(sel),
            "median_quote_vol": float(np.median(liq[sel])),
            "mean_lead1": float(np.nanmean(leads[sel])),
            "mean_contemp": float(np.nanmean(
                [per_coin[j]["corr_contemp"] or np.nan for j in sel])),
        })
    # Rank correlation between liquidity and lead strength (Spearman by hand).
    ok = np.isfinite(leads)
    grad = None
    if ok.sum() > 10:
        rl = pd.Series(liq[ok]).rank().to_numpy()
        rd = pd.Series(leads[ok]).rank().to_numpy()
        grad = float(np.corrcoef(rl, rd)[0, 1])

    return {
        "n_coins": len(per_coin),
        "lead1": summary_stats(lead),
        "contemp": summary_stats(contemp),
        "reverse_lead1_control": summary_stats(reverse),
        "own_ar1": summary_stats(ar1),
        "coins_with_t_gt_2": int((np.abs(tl) > 2).sum()),
        "coins_with_t_gt_2_pct": (
            round(100 * float((np.abs(tl) > 2).mean()), 1) if len(tl) else None
        ),
        "block_test": block,
        "liquidity_deciles": deciles,
        "spearman_liquidity_vs_lead": grad,
    }


def summary_stats(a: np.ndarray) -> dict:
    if not len(a):
        return {}
    return {
        "mean": float(a.mean()), "median": float(np.median(a)),
        "p10": float(np.percentile(a, 10)), "p90": float(np.percentile(a, 90)),
        "min": float(a.min()), "max": float(a.max()),
        "share_positive": round(float((a > 0).mean()), 3),
    }


def aggregate_streaks(pooled: dict[tuple[str, int], list]) -> dict:
    """Per-variant stats overall and split into liquidity terciles.

    The tercile split is the bid-ask-bounce control: an edge concentrated in the
    thinnest coins is most likely the spread bouncing, not overreaction.
    """
    out: dict[str, dict] = {}
    for (name, k), chunks in sorted(pooled.items()):
        liq = np.array([c[0] for c in chunks])
        accs = [c[1] for c in chunks]
        entry = stats_from_monthly(sum(accs))
        if len(liq) >= 6:
            lo, hi = np.percentile(liq, [33.3, 66.7])
            groups = {
                "thin": [a for a, q in zip(accs, liq) if q <= lo],
                "mid": [a for a, q in zip(accs, liq) if lo < q <= hi],
                "liquid": [a for a, q in zip(accs, liq) if q > hi],
            }
            entry["by_liquidity"] = {
                g: stats_from_monthly(sum(v)) for g, v in groups.items() if v
            }
        out[f"{name}_k{k}"] = entry
    return out


def print_summary(report: dict) -> None:
    a = report["part_a"]
    print("\n" + "=" * 72)
    print(f"PART A [{INTERVAL}] — does BTC lead the alts?")
    print("=" * 72)
    print(f"coins analysed: {a['n_coins']}")
    print(f"contemporaneous corr : median {a['contemp']['median']:+.3f}")
    print(f"BTC leads by 1 bar   : median {a['lead1']['median']:+.4f}  "
          f"(p10 {a['lead1']['p10']:+.4f} / p90 {a['lead1']['p90']:+.4f}, "
          f"{100 * a['lead1']['share_positive']:.0f}% positive)")
    print(f"alt leads BTC (ctrl) : median {a['reverse_lead1_control']['median']:+.4f}")
    print(f"own AR(1)            : median {a['own_ar1']['median']:+.4f}")
    b = a["block_test"]
    if b["mean"] is None:
        print(f"monthly-block lead   : no coin-month cleared {MIN_MONTH_OBS} bars")
    else:
        bt = f"{b['t']:+.2f}" if b["t"] is not None else "—"
        print(f"monthly-block lead   : mean {b['mean']:+.4f}, t {bt}, "
              f"{b['months_positive']}/{b['n_months']} months positive")
    sp = a["spearman_liquidity_vs_lead"]
    print(f"spearman(liquidity, lead) = {sp:+.3f}  "
          "(negative ⇒ thinner coins have the stronger lead)"
          if sp is not None else "spearman(liquidity, lead): n/a")
    print("\n  liquidity deciles (1 = thinnest):")
    for d in a["liquidity_deciles"]:
        print(f"    {d['decile']:2d}  vol {d['median_quote_vol']:>14,.0f}  "
              f"lead {d['mean_lead1']:+.4f}   contemp {d['mean_contemp']:+.3f}")

    print("\n" + "=" * 72)
    print("PART B — streak reversion, raw vs BTC-explained vs idiosyncratic")
    print("(mean bps = gross reversion per trade; fee hurdle is 8 bps round-trip)")
    print("=" * 72)
    hdr = (f"{'variant':<20}{'n events':>12}{'mean bps':>10}{'rev rate':>10}"
           f"{'block t':>9}{'pooled t':>10}   thin/mid/liquid mean bps")
    print(hdr)
    for key, e in report["part_b"].items():
        if "mean_bps" not in e:
            continue
        liq = e.get("by_liquidity", {})
        split = " / ".join(
            f"{liq[g]['mean_bps']:+.2f}" if g in liq and "mean_bps" in liq[g] else "  —  "
            for g in ("thin", "mid", "liquid")
        )
        print(f"{key:<20}{e['n_events']:>12,}{e['mean_bps']:>10.2f}"
              f"{e['reversion_rate']:>10.3f}{str(e.get('block_t')):>9}"
              f"{str(e.get('pooled_t_INFLATED')):>10}   {split}")
    print("\nRead the _skip1 rows against their parents: if the edge collapses when "
          "entry is delayed one bar, it was bid-ask bounce, not overreaction.")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
