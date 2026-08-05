"""Part C of the cross-coin study: how big does a BTC move have to be before the
alt's follow-through is worth trading?

Part A established that BTC leads the alts by one 5m bar (median corr +0.07,
stronger in thinner books). A correlation of 0.07 explains half a percent of the
next bar's variance, which says nothing about whether it clears costs. This
script converts the lead into the only unit that decides that: expected basis
points on the next bar, conditioned on how large BTC's move was.

Method: for each bar where BTC moved more than X trailing sigmas, take the alt's
NEXT bar return signed in BTC's direction. That is what a follow-the-leader trade
would earn gross. Compare against the paper engine's 8 bps round-trip default.

FAVOURABLE-CASE BIAS, stated up front: the measured return is close[t+1]/close[t],
but a real fill happens at bar t+1's OPEN, so this estimate hands the strategy the
close→open jump for free. Every number here is therefore an upper bound.

Reuses the loaders and grid helpers from study_cross_coin_lead_lag.py.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

import asyncpg
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from study_cross_coin_lead_lag import (  # noqa: E402
    BAR_SECONDS,
    BETA_HALFLIFE,
    BTC_SYMBOL,
    INTERVAL,
    MIN_BARS,
    MIN_MEDIAN_ABS_BPS,
    N_SLOTS,
    START,
    eligible_coins,
    load_series,
    log_returns,
    month_agg,
    shift,
    stats_from_monthly,
)

DSN = os.environ.get("STUDY_DSN", "postgresql://gorm:gorm@localhost:5433/crypto_ai")
OUT_DIR = os.environ.get("STUDY_OUT", "/tmp/cross_coin_study")
# Every Nth coin by symbol order — a spread across the liquidity range without
# paying for all 339 again.
SAMPLE_EVERY = int(os.environ.get("STUDY_EVERY", "6"))
# Trailing window for BTC's own volatility, so "a big move" is scaled to regime.
# One day of bars at whichever interval the study is running (see BETA_HALFLIFE).
SIGMA_WINDOW = BETA_HALFLIFE
SIGMA_BUCKETS = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 5.0), (5.0, np.inf)]
FEE_BPS = 8.0


async def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = await asyncpg.connect(DSN)
    try:
        coins = await eligible_coins(conn)
        btc = next(c for c in coins if c["symbol"] == BTC_SYMBOL)
        alts = [c for c in coins if c["symbol"] != BTC_SYMBOL][::SAMPLE_EVERY]
        print(f"sample: {len(alts)} coins", flush=True)

        btc_close, _ = await load_series(conn, btc["id"])
        r_btc = log_returns(btc_close)
        # Causal trailing sigma of BTC (shifted so bar t's sigma excludes bar t).
        sigma = (
            pd.Series(r_btc).rolling(SIGMA_WINDOW, min_periods=SIGMA_WINDOW).std()
            .shift(1).to_numpy()
        )
        with np.errstate(invalid="ignore", divide="ignore"):
            z_btc = np.where(sigma > 0, r_btc / sigma, np.nan)

        slot_times = pd.to_datetime(
            START.timestamp() + np.arange(N_SLOTS) * BAR_SECONDS, unit="s", utc=True
        )
        mcode = (slot_times.year * 12 + slot_times.month).to_numpy()
        month_idx = (mcode - mcode.min()).astype(np.int64)
        n_months = int(month_idx.max()) + 1

        acc: dict[str, list[tuple[float, np.ndarray]]] = {}
        for i, coin in enumerate(alts, 1):
            close, qv = await load_series(conn, coin["id"])
            r_alt = log_returns(close)
            fin = np.isfinite(r_alt)
            if fin.sum() < MIN_BARS // 2:
                continue
            if float(np.median(np.abs(r_alt[fin])) * 1e4) < MIN_MEDIAN_ABS_BPS:
                continue
            liq = float(np.nanmedian(qv))

            nxt = shift(r_alt, -1)  # the bar you would actually trade
            follow = np.sign(r_btc) * nxt * 1e4  # bps, signed with BTC's move
            az = np.abs(z_btc)
            for lo, hi in SIGMA_BUCKETS:
                sel = (az >= lo) & (az < hi) & np.isfinite(follow)
                if sel.sum() < 100:
                    continue
                key = f"{lo:g}-{hi:g}σ"
                acc.setdefault(key, []).append(
                    (liq, month_agg(follow[sel], month_idx[sel], n_months))
                )
            if i % 20 == 0:
                print(f"  {i}/{len(alts)}", flush=True)

        report = {}
        for key, chunks in acc.items():
            liq = np.array([c[0] for c in chunks])
            accs = [c[1] for c in chunks]
            entry = stats_from_monthly(sum(accs))
            if len(liq) >= 6:
                lo_q, hi_q = np.percentile(liq, [33.3, 66.7])
                groups = {
                    "thin": [a for a, q in zip(accs, liq) if q <= lo_q],
                    "liquid": [a for a, q in zip(accs, liq) if q > hi_q],
                }
                entry["by_liquidity"] = {
                    g: stats_from_monthly(sum(v)) for g, v in groups.items() if v
                }
            report[key] = entry

        path = os.path.join(OUT_DIR, "followthrough.json")
        with open(path, "w") as fh:
            json.dump(report, fh, indent=2)

        print("\n" + "=" * 78)
        print(f"PART C [{INTERVAL}] — alt follow-through on the bar AFTER a BTC move")
        print("(mean bps, signed with BTC; upper bound — assumes a fill at the "
              "previous close)")
        print("=" * 78)
        print(f"{'BTC move':<12}{'n bars':>12}{'mean bps':>10}{'hit rate':>10}"
              f"{'block t':>9}{'thin':>9}{'liquid':>9}   vs {FEE_BPS:g} bps fee")
        for key in [f"{lo:g}-{hi:g}σ" for lo, hi in SIGMA_BUCKETS]:
            e = report.get(key)
            if not e or "mean_bps" not in e:
                continue
            liq = e.get("by_liquidity", {})
            thin = liq.get("thin", {}).get("mean_bps")
            lqd = liq.get("liquid", {}).get("mean_bps")
            verdict = "CLEARS" if e["mean_bps"] > FEE_BPS else "below"
            print(f"{key:<12}{e['n_events']:>12,}{e['mean_bps']:>10.2f}"
                  f"{e['reversion_rate']:>10.3f}{str(e.get('block_t')):>9}"
                  f"{thin if thin is None else f'{thin:+.2f}':>9}"
                  f"{lqd if lqd is None else f'{lqd:+.2f}':>9}   {verdict}")
        print("\n('hit rate' = share of bars where the alt continued in BTC's "
              "direction)")
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
