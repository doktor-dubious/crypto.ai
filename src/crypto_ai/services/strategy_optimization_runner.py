"""Executing an optimization: many backtests over one market, honestly scored.

Cost shape, which dictates the whole design: loading klines and computing the
signal features dominates a single backtest, while the trade loop itself is
milliseconds. So the runner is **coin-major** — one context per (coin, pair,
timeframe), reused by every combo on that market — and within a market it caches
the SCORE ARRAYS by the axes that actually change them:

    (require_voldiv, btc_filter, volGate, htfGate)

That is at most 2×3×3×4 = 72 score computations for a market, however many
thousand combos run against them. Everything else — streak length, hold, side,
stop, target — only re-runs the trade loop.

Scoring splits every result into TRAIN (first half) and VALIDATION (second half)
alongside the full range. Searching thousands of combos and ranking on the full
range finds the best-fitting noise: under pure chance the top |t| of N combos is
about sqrt(2·ln N) — ~3.7 at N=1000. Train/validation is the only thing that
tells a real edge from a lucky one, so the schema records both and the UI ranks
on train while reporting validation.
"""

from __future__ import annotations

import math

import numpy as np

from crypto_ai.services.scalp_analysis import DEFAULTS as SCALP_DEFAULTS
from crypto_ai.services.scalp_analysis import ScalpAnalysisService
from crypto_ai.services.swing_analysis import (
    _Z_WIN,
    COMPONENT_KEYS,
    FLAG_KEYS,
    _max_drawdown,
    # One definition of t for the whole app: the analyze endpoint and the grid
    # search must agree, and the degenerate-sample guard has to hold in both.
    _t_stat,
    apply_trend_gate,
    htf_lookback_bars,
    htf_min_bars,
)

ALL_SWING_SIGNALS = set(COMPONENT_KEYS) | set(FLAG_KEYS)


def _segment_stats(trades: list[dict], strat_ret: np.ndarray, lo: int, hi: int) -> dict:
    """Performance of the trades that ENTERED inside [lo, hi)."""
    sub = [x for x in trades if lo <= x["i"] < hi]
    rets = [float(x["ret"]) for x in sub]
    seg = strat_ret[lo:hi]
    total = float((np.cumprod(1.0 + seg)[-1] - 1.0) * 100) if len(seg) else 0.0
    wins = sum(1 for r in rets if r > 0)
    return {
        "n_trades": len(rets),
        "win_rate_pct": round(wins / len(rets) * 100, 2) if rets else 0.0,
        "avg_net_bps": round(sum(rets) / len(rets) * 1e4, 2) if rets else 0.0,
        "edge_t": round(_t_stat(rets), 2),
        "total_return_pct": round(total, 2),
    }


def _payoff_shape(rets: list[float], strat_ret: np.ndarray, lo: int, hi: int) -> dict:
    """How the returns are SHAPED, beyond their average.

    Skew is the third standardised moment of the per-trade returns: strongly
    negative means many small wins paid for by rare large losses (the mean
    reversion signature, which t flatters); strongly positive is the reverse
    (the trend signature, which t penalises). Drawdown and the worst single
    trade say how bad the bad case actually was — the question skew only hints at.
    """
    if len(rets) < 3:
        return {"skew": None, "max_drawdown_pct": None, "worst_trade_bps": None}
    mu = sum(rets) / len(rets)
    var = sum((x - mu) ** 2 for x in rets) / len(rets)
    sd = math.sqrt(var)
    skew = (
        sum(((x - mu) / sd) ** 3 for x in rets) / len(rets) if sd > 0 else 0.0
    )
    seg = strat_ret[lo:hi]
    equity = np.cumprod(1.0 + seg) if len(seg) else np.array([1.0])
    return {
        "skew": round(float(skew), 3),
        "max_drawdown_pct": round(float(_max_drawdown(equity) * 100), 2),
        "worst_trade_bps": round(float(min(rets)) * 1e4, 2),
    }


class OptimizationRunner:
    """Runs every combo of one market and returns their scores."""

    def __init__(self, session) -> None:
        self.scalp = ScalpAnalysisService(session)

    async def run_market(
        self, coin_id: str, quote_asset: str, interval: str,
        start_date, end_date, combos: list[dict], strategy: str = "streak",
    ) -> tuple[list[dict], str | None]:
        """Score every combo on one market.

        Returns ``(results, error)``. A market whose klines can't support the
        analysis yields ``([], reason)`` — its combos are counted as SKIPPED
        rather than silently scored as zero, which would drag every ranking
        toward a strategy that simply never traded.
        """
        scope = {
            "coin_id": coin_id, "quote_asset": quote_asset, "interval": interval,
            "start_date": start_date, "end_date": end_date,
        }
        # Size the context for the most demanding combo in this market: the
        # longest hold and the deepest higher-timeframe lookback.
        max_hold = max(int(c["params"].get("holdBars", 6)) for c in combos)
        htf_bars_max = 0
        need_btc = False
        for c in combos:
            p = c["params"]
            if p.get("htfGate", "off") != "off":
                htf_bars_max = max(
                    htf_bars_max, htf_lookback_bars(interval, str(p.get("htfTf", "4h")))
                )
            if int((p.get("paramValues") or {}).get("btc_filter", 0)) > 0:
                need_btc = True

        is_swings = strategy == "swings"
        ctx = await self.scalp._swings._build_context(
            scope,
            min_bars=max(300, _Z_WIN, htf_min_bars(htf_bars_max)) + max_hold + 10,
            need_btc=need_btc,
        )
        if "error" in ctx:
            return [], str(ctx["error"])

        n = ctx["n"]
        first = ctx["first"]
        # The overfitting check: tune on the first half, judge on the second.
        mid = first + (n - first) // 2
        # The swing composite's breakout VETO is part of the strategy — an
        # overbought top on heavy volume is a breakout, not a crest, and fading
        # it loses. The scalp strategies have no such notion and zero it, so
        # applying the scalp treatment to swings would silently change what the
        # strategy is.
        base_ctx = ctx if is_swings else {**ctx, "veto_top": np.zeros(n, dtype=bool)}

        # Score arrays keyed by the axes that change them — see the module docstring.
        cache: dict[tuple, tuple[np.ndarray, np.ndarray]] = {}

        def scores_for(p: dict) -> tuple[np.ndarray, np.ndarray]:
            # Keyed on whatever this strategy's signal actually depends on —
            # every knob in paramValues plus the two gates — rather than on an
            # enumerated list, so a new strategy needs no change here. Threshold,
            # hold, side and the exits are deliberately absent: they act in the
            # trade loop, not on the scores, which is what makes the cache pay.
            pv = p.get("paramValues") or {}
            # Swings is driven by which composite members are enabled and how
            # they're weighted, not by a params dict — so its cache key is those.
            disabled = tuple(sorted(p.get("disabledSignals") or []))
            weights = tuple(sorted((k, float(v)) for k, v in (p.get("weightPct") or {}).items()))
            key = (
                tuple(sorted((k, float(v)) for k, v in pv.items())),
                str(p.get("indicator", "ema")),
                disabled, weights,
                p.get("volGate", "off"), float(p.get("volLevel", 1.0)),
                p.get("htfGate", "off"), str(p.get("htfTf", "4h")), float(p.get("htfLevel", 0.5)),
            )
            hit = cache.get(key)
            if hit is not None:
                return hit
            if is_swings:
                enabled = ALL_SWING_SIGNALS - set(disabled)
                # _composite_scores returns (bottom, top) — bottom buys the dip
                # (long), top fades the crest (short), which is the same order the
                # trade engine expects.
                long_s, short_s = self.scalp._swings._composite_scores(
                    base_ctx, enabled, {k: v / 100.0 for k, v in weights},
                )
            else:
                sig_params = {
                    **SCALP_DEFAULTS.get(strategy, {}),
                    **{k: float(v) for k, v in pv.items()},
                }
                long_s, short_s = self.scalp._signals(
                    base_ctx, strategy, str(p.get("indicator", "ema")), sig_params
                )
            if key[4] != "off":
                long_s, short_s = self.scalp._apply_vol_gate(
                    base_ctx, long_s, short_s, key[4], key[5]
                )
            if key[6] != "off":
                bars = htf_lookback_bars(interval, key[7])
                long_s, short_s = apply_trend_gate(
                    base_ctx, long_s, short_s, key[6], bars, key[8]
                )
            cache[key] = (long_s, short_s)
            return long_s, short_s

        results: list[dict] = []
        for combo in combos:
            p = combo["params"]
            long_s, short_s = scores_for(p)
            sim = self.scalp._swings._run_trades(
                base_ctx, long_s, short_s,
                threshold=float(p.get("threshold", 3)),
                hold_bars=int(p.get("holdBars", 6)),
                fee_bps=float(p.get("feeBps", 4)),
                side=str(p.get("side", "both")),
                sl_mode=str(p.get("slMode", "none")),
                sl_value=float(p.get("slValue", 2.0)),
                tp_mode=str(p.get("tpMode", "none")),
                tp_value=float(p.get("tpValue", 3.0)),
                prob_by_time={},
            )
            trades, strat_ret = sim["trades"], sim["strat_ret"]
            full = _segment_stats(trades, strat_ret, first, n)
            train = _segment_stats(trades, strat_ret, first, mid)
            val = _segment_stats(trades, strat_ret, mid, n)
            # Shape is read over the FULL range: skew needs every sample it can
            # get, and a half-range drawdown understates the real one.
            shape = _payoff_shape(
                [float(x["ret"]) for x in trades if first <= x["i"] < n],
                strat_ret, first, n,
            )
            results.append({
                "coin_id": coin_id,
                "quote_asset": quote_asset,
                "interval": interval,
                "params": p,
                "is_baseline": bool(combo.get("is_baseline")),
                "n_trades": full["n_trades"],
                "avg_net_bps": full["avg_net_bps"],
                "edge_t": full["edge_t"],
                "win_rate_pct": full["win_rate_pct"],
                "total_return_pct": full["total_return_pct"],
                "train_n_trades": train["n_trades"],
                "train_avg_net_bps": train["avg_net_bps"],
                "train_edge_t": train["edge_t"],
                "val_n_trades": val["n_trades"],
                "val_avg_net_bps": val["avg_net_bps"],
                "val_edge_t": val["edge_t"],
                **shape,
            })
        return results, None
