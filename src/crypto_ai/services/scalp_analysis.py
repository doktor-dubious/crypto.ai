"""Scalping-strategy analysis (Trading → Strategies → Scalping → …).

Three classic scalping families evaluated on stored klines, reusing the swing
machinery end to end: the cached kline context, the fee-aware non-overlapping
trade engine with SL/TP/hold-max exits, and the honest first-half/second-half
segment split. Each strategy only contributes its ENTRY signal — a pair of
per-bar (long_score, short_score) series compared against a threshold:

- range:     fade the edges of a tight N-bar channel (buy support / sell
             resistance), only while the channel is narrow enough to be a
             genuine range. Scores are σ-like: how deep into the edge band
             price has pushed.
- momentum:  trade WITH an N-bar channel breakout when volume confirms —
             the tradeable mirror of the swing explorer's breakout veto
             (overbought on heavy volume CONTINUES). Score = volume z-score
             on breakout bars, so the threshold slider means "required
             volume spike (σ)".
- indicator: classic single-indicator triggers (EMA cross, RSI, Bollinger,
             rolling VWAP), normalised to σ-like scores. Published evidence
             (and our prior): raw indicator rules net of fees ≈ break-even
             minus costs — this page exists to measure that honestly.

All signals are trailing-only (no lookahead); heavy compute runs off the
event loop; the analysis is pure kline data — no simulation involved.
"""

from __future__ import annotations

import asyncio
import math

import numpy as np
import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.services.kline_simulation_record import _interval_minutes
from crypto_ai.services.swing_analysis import (
    _MAX_CURVE_POINTS,
    _MAX_TRADE_MARKERS,
    BTC_FILTERS,
    TREND_GATES,
    SwingAnalysisService,
    _roll_z,
    _t_stat,
    apply_btc_beta_filter,
    apply_trend_gate,
    htf_lookback_bars,
    htf_min_bars,
)
from crypto_ai.services.trade_buckets import bucket_analysis_of, build_trade_rows

STRATEGIES = ("range", "momentum", "indicator", "streak", "sweep", "takerflow")
INDICATOR_KINDS = ("ema", "rsi", "bollinger", "vwap")
VOL_GATES = ("off", "calm", "expanding")

# Strategy parameter defaults; every knob is overridable per request.
DEFAULTS: dict[str, dict[str, float]] = {
    "range": {"window": 48, "band_pct": 15.0, "max_width_pct": 3.0},
    "momentum": {"window": 48},
    "indicator": {"fast": 9, "slow": 21, "period": 14, "vwap_window": 96},
    # require_voldiv: 1 = only fade streaks advancing on falling volume (the
    # conditioner that roughly doubled the fade edge in the research).
    # btc_filter: 0 = off, 1 = fade only runs BTC does NOT explain, 2 = fade only
    # runs it does (the null control — see apply_btc_beta_filter).
    "streak": {"require_voldiv": 0, "btc_filter": 0},
    "sweep": {"window": 12},
    # fade: 0 = trade WITH sustained taker imbalance, 1 = fade it (exhaustion).
    "takerflow": {"window": 12, "fade": 0},
}


def _rsi(close: np.ndarray, period: int) -> np.ndarray:
    """Wilder's RSI (ewm smoothing), trailing-only."""
    s = pd.Series(close)
    delta = s.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, min_periods=period).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, min_periods=period).mean()
    rs = gain / loss.where(loss > 0)
    rsi = 100 - 100 / (1 + rs)
    rsi = rsi.where(loss > 0, 100.0)  # no losses in window → maximally overbought
    return rsi.to_numpy()


class ScalpAnalysisService:
    """Entry-signal builders + shared trade engine for the scalping pages."""

    def __init__(self, session: AsyncSession):
        self.session = session
        # Reuses the swing service's cached kline context and trade engine —
        # the strategies differ only in how entries are scored.
        self._swings = SwingAnalysisService(session)

    async def analyze(
        self,
        scope: dict,
        strategy: str,
        *,
        threshold: float = 1.0,
        hold_bars: int = 6,
        fee_bps: float = 8.0,
        side: str = "both",
        sl_mode: str = "none",
        sl_value: float = 2.0,
        tp_mode: str = "none",
        tp_value: float = 3.0,
        params: dict[str, float] | None = None,
        indicator: str = "ema",
        vol_gate: str = "off",
        vol_level: float = 1.0,
        htf_gate: str = "off",
        htf_tf: str = "4h",
        htf_level: float = 0.5,
        buckets: bool = False,
        tz_offset_minutes: int = 0,
    ) -> dict | None:
        if strategy not in STRATEGIES:
            return {"error": f"Unknown strategy: {strategy}"}
        if indicator not in INDICATOR_KINDS:
            return {"error": f"Unknown indicator: {indicator}"}
        if vol_gate not in VOL_GATES:
            return {"error": f"Unknown vol_gate: {vol_gate}"}
        if htf_gate not in TREND_GATES:
            return {"error": f"Unknown htf_gate: {htf_gate}"}
        if sl_mode not in ("none", "pct", "atr", "structure", "trail_atr"):
            return {"error": f"Unknown sl_mode: {sl_mode}"}
        if tp_mode not in ("none", "pct", "resistance", "reversal", "mean"):
            return {"error": f"Unknown tp_mode: {tp_mode}"}
        p = {**DEFAULTS[strategy], **{k: float(v) for k, v in (params or {}).items()}}

        # The trend gate reads a long trailing span off the base series, so it
        # raises the history the scope needs before anything can be evaluated.
        htf_bars = 0 if htf_gate == "off" else htf_lookback_bars(scope["interval"], htf_tf)
        ctx = await self._swings._build_context(
            scope,
            min_bars=max(300, htf_min_bars(htf_bars)) + hold_bars,
            need_btc=strategy == "streak" and int(p.get("btc_filter", 0)) > 0,
        )
        if "error" in ctx:
            return ctx

        long_score, short_score = await asyncio.to_thread(
            self._signals, ctx, strategy, indicator, p
        )
        if vol_gate != "off":
            long_score, short_score = await asyncio.to_thread(
                self._apply_vol_gate, ctx, long_score, short_score, vol_gate, vol_level
            )
        if htf_gate != "off":
            long_score, short_score = await asyncio.to_thread(
                apply_trend_gate, ctx, long_score, short_score,
                htf_gate, htf_bars, htf_level,
            )
        # No swing-veto for scalping: momentum WANTS the high-volume breakout,
        # and range entries are already regime-gated by channel width.
        scalp_ctx = {**ctx, "veto_top": np.zeros(ctx["n"], dtype=bool)}

        sim = await asyncio.to_thread(
            self._swings._run_trades,
            scalp_ctx, long_score, short_score,
            threshold=threshold, hold_bars=hold_bars, fee_bps=fee_bps, side=side,
            sl_mode=sl_mode, sl_value=sl_value, tp_mode=tp_mode, tp_value=tp_value,
            prob_by_time={},
        )
        result = await asyncio.to_thread(
            self._assemble, ctx, sim, long_score, short_score, scope["interval"],
            {
                "strategy": strategy, "indicator": indicator, "params": p,
                "threshold": threshold, "hold_bars": hold_bars, "fee_bps": fee_bps,
                "side": side, "sl_mode": sl_mode, "sl_value": sl_value,
                "tp_mode": tp_mode, "tp_value": tp_value,
                "vol_gate": vol_gate, "vol_level": vol_level,
                "htf_gate": htf_gate, "htf_tf": htf_tf, "htf_level": htf_level,
                # 0 when the picked timeframe isn't actually higher than the
                # scope's — the gate is then inert, and the UI must say so.
                "htf_bars": htf_bars,
            },
        )
        result["trade_rows"] = build_trade_rows(sim["trades"])
        if buckets:
            result["bucket_analysis"] = bucket_analysis_of(
                sim["trades"], tz_offset_minutes=tz_offset_minutes
            )
        return result

    @staticmethod
    def _apply_vol_gate(
        ctx: dict, long_score: np.ndarray, short_score: np.ndarray,
        vol_gate: str, vol_level: float,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Restrict entries to a volatility regime.

        Regime metric: the 14-bar ATR relative to its own trailing 200-bar
        median (both trailing-only). "calm" trades only when the ratio is at or
        below ``vol_level``; "expanding" only at or above it. This is the
        researched pairing — ranges hold in calm regimes; breakouts continue in
        expansions — exposed as a gate on every scalp strategy.
        """
        atr = ctx["atr"]
        base = pd.Series(atr).rolling(200, min_periods=100).median().shift(1).to_numpy()
        with np.errstate(invalid="ignore", divide="ignore"):
            ratio = atr / np.where(base > 0, base, np.nan)
        ok = ratio <= vol_level if vol_gate == "calm" else ratio >= vol_level
        ok = ok & ~np.isnan(ratio)
        return (
            np.where(ok, long_score, np.nan),
            np.where(ok, short_score, np.nan),
        )

    # ── Entry signals (all trailing-only) ────────────────────────────────────

    @staticmethod
    def _signals(
        ctx: dict, strategy: str, indicator: str, p: dict[str, float]
    ) -> tuple[np.ndarray, np.ndarray]:
        n = ctx["n"]
        h = ctx["h"]
        low = ctx["low"]
        c = ctx["c"]
        nan = np.full(n, np.nan)

        if strategy == "range":
            w = max(5, int(p["window"]))
            band = min(0.49, max(0.01, p["band_pct"] / 100.0))
            # Channel from the PRIOR w bars (shifted — the current bar can't
            # define its own support/resistance).
            hi = pd.Series(h).rolling(w).max().shift(1).to_numpy()
            lo = pd.Series(low).rolling(w).min().shift(1).to_numpy()
            width = hi - lo
            mid = (hi + lo) / 2.0
            with np.errstate(invalid="ignore", divide="ignore"):
                width_pct = width / np.where(mid > 0, mid, np.nan) * 100.0
                # Regime gate: only a NARROW channel is a tradeable range —
                # wide channels are trends, where fading the edge is suicide.
                in_range = (width_pct <= p["max_width_pct"]) & (c <= hi) & (c >= lo)
                # σ-like score: how many band-widths into the edge zone price
                # has pushed (1.0 = exactly at the band boundary).
                long_raw = (lo + band * width - c) / (band * width) + 1.0
                short_raw = (c - (hi - band * width)) / (band * width) + 1.0
            long_score = np.where(in_range & (width > 0), long_raw, np.nan)
            short_score = np.where(in_range & (width > 0), short_raw, np.nan)
            return long_score, short_score

        if strategy == "momentum":
            w = max(5, int(p["window"]))
            hi = pd.Series(h).rolling(w).max().shift(1).to_numpy()
            lo = pd.Series(low).rolling(w).min().shift(1).to_numpy()
            # Volume z-score (vs trailing median/std) — already in the shared
            # context as the swing composite's "volume" component.
            z_vol = ctx["top_components"]["volume"]
            breakout_up = c > hi
            breakout_dn = c < lo
            # Trade WITH the break; threshold = required volume spike in σ.
            long_score = np.where(breakout_up, z_vol, nan)
            short_score = np.where(breakout_dn, z_vol, nan)
            return long_score, short_score

        if strategy == "streak":
            # Fade runs of same-direction closes — the one directional effect
            # PROVEN in this data (~55–60% reversal after 4+ bars). Score =
            # run length, so the threshold means "required streak length".
            streak = ctx["streak"]
            long_score = np.where(streak < 0, -streak, nan)   # fade down-runs
            short_score = np.where(streak > 0, streak, nan)   # fade up-runs
            if p.get("require_voldiv", 0) >= 1:
                # Only fade advances on FALLING volume — the conditioner that
                # roughly doubled the fade edge in the research.
                long_score = np.where(ctx["bottom_flags"]["voldiv"], long_score, nan)
                short_score = np.where(ctx["top_flags"]["voldiv"], short_score, nan)
            # Drop runs that are just this coin tracking BTC — they don't revert.
            mode = int(p.get("btc_filter", 0))
            if 0 < mode < len(BTC_FILTERS):
                long_score, short_score = apply_btc_beta_filter(
                    ctx, long_score, short_score, BTC_FILTERS[mode]
                )
            return long_score, short_score

        if strategy == "sweep":
            # Failed-breakout / stop-hunt fade: the bar trades beyond the prior
            # N-bar extreme but CLOSES back inside — fade the rejection. Score =
            # how far beyond the level the sweep reached, in ATRs.
            w = max(3, int(p["window"]))
            atr = ctx["atr"]
            prior_hi = pd.Series(h).rolling(w).max().shift(1).to_numpy()
            prior_lo = pd.Series(low).rolling(w).min().shift(1).to_numpy()
            with np.errstate(invalid="ignore", divide="ignore"):
                depth_hi = (h - prior_hi) / np.where(atr > 0, atr, np.nan)
                depth_lo = (prior_lo - low) / np.where(atr > 0, atr, np.nan)
            swept_hi = (h > prior_hi) & (c < prior_hi)  # rejected above → short
            swept_lo = (low < prior_lo) & (c > prior_lo)  # rejected below → long
            long_score = np.where(swept_lo, depth_lo, nan)
            short_score = np.where(swept_hi, depth_hi, nan)
            return long_score, short_score

        if strategy == "takerflow":
            # Sustained aggressive-flow imbalance: rolling mean of the taker-buy
            # ratio centered on 0.5, z-scored vs its own trailing distribution.
            # fade=0 trades WITH the flow (momentum); fade=1 against it
            # (exhaustion — the taker tilt measured at swing points).
            w = max(2, int(p["window"]))
            imb = pd.Series(ctx["taker_ratio"] - 0.5).rolling(w).mean().to_numpy()
            z = _roll_z(imb)
            if p.get("fade", 0) >= 1:
                z = -z
            long_score = np.where(z > 0, z, nan)
            short_score = np.where(z < 0, -z, nan)
            return long_score, short_score

        # indicator
        if indicator == "ema":
            fast = pd.Series(c).ewm(span=max(2, int(p["fast"]))).mean()
            slow = pd.Series(c).ewm(span=max(3, int(p["slow"]))).mean()
            above = (fast > slow).to_numpy()
            prev = np.roll(above, 1)
            prev[0] = above[0]
            # Binary cross events scored 1.0 → any threshold ≤ 1 triggers.
            long_score = np.where(above & ~prev, 1.0, nan)
            short_score = np.where(~above & prev, 1.0, nan)
            return long_score, short_score

        if indicator == "rsi":
            period = max(2, int(p["period"]))
            rsi = _rsi(c, period)
            # σ-like: 0 at the classic 30/70 levels, +1 per extra 10 RSI points.
            long_score = (30.0 - rsi) / 10.0
            short_score = (rsi - 70.0) / 10.0
            return long_score, short_score

        if indicator == "bollinger":
            period = max(5, int(p["period"]))
            s = pd.Series(c)
            ma = s.rolling(period).mean().to_numpy()
            sd = s.rolling(period).std().to_numpy()
            with np.errstate(invalid="ignore", divide="ignore"):
                # σ beyond the 2σ band (0 = touching the band).
                long_score = ((ma - 2 * sd) - c) / np.where(sd > 0, sd, np.nan)
                short_score = (c - (ma + 2 * sd)) / np.where(sd > 0, sd, np.nan)
            return long_score, short_score

        # vwap: deviation from rolling volume-weighted price, in close-σ units.
        w = max(5, int(p["vwap_window"]))
        vol = ctx["vol"]
        typical = (h + low + c) / 3.0
        pv = pd.Series(typical * vol).rolling(w).sum()
        vv = pd.Series(vol).rolling(w).sum()
        vwap = (pv / vv.where(vv > 0)).to_numpy()
        sd = pd.Series(c).rolling(w).std().to_numpy()
        with np.errstate(invalid="ignore", divide="ignore"):
            dev = (vwap - c) / np.where(sd > 0, sd, np.nan)
        return dev, -dev

    # ── Response assembly (mirrors the swing analyze post-processing) ────────

    def _assemble(
        self, ctx: dict, sim: dict,
        long_score: np.ndarray, short_score: np.ndarray,
        interval: str, echo: dict,
    ) -> dict:
        n = ctx["n"]
        first = ctx["first"]
        times = ctx["times"]
        c = ctx["c"]
        fee_rt = echo["fee_bps"] / 1e4
        trades = sim["trades"]
        strat_ret = sim["strat_ret"]

        bar_ret = np.zeros(n)
        bar_ret[1:] = c[1:] / c[:-1] - 1.0
        sim_slice = slice(first, n)
        equity = np.cumprod(1.0 + strat_ret[sim_slice])
        bh = np.cumprod(1.0 + bar_ret[sim_slice]) * (1.0 - fee_rt)
        sim_times = times[sim_slice]
        n_bars = len(equity)
        periods_per_year = max(1, int(365 * 24 * 60 / _interval_minutes(interval)))

        def _segment(label: str, lo: int, hi: int) -> dict:
            seg_tr = [x for x in trades if lo + first <= x["i"] < hi + first]
            rets = [x["ret"] for x in seg_tr]
            eq = equity[lo:hi]
            sr = strat_ret[sim_slice][lo:hi]
            sharpe = 0.0
            if len(sr) > 1 and np.std(sr) > 0:
                sharpe = float(np.mean(sr) / np.std(sr) * math.sqrt(periods_per_year))
            peak = np.maximum.accumulate(eq) if len(eq) else np.array([1.0])
            mdd = float(-(eq / peak - 1.0).min()) if len(eq) else 0.0
            return {
                "label": label,
                "n_trades": len(seg_tr),
                "win_rate_pct": (sum(1 for x in rets if x > 0) / len(rets) * 100) if rets else 0.0,
                "avg_net_bps": (sum(rets) / len(rets) * 1e4) if rets else 0.0,
                "edge_t": round(_t_stat(rets), 2),
                "total_return_pct": float((eq[-1] / eq[0] - 1) * 100) if len(eq) else 0.0,
                "buy_hold_return_pct": (
                    float((bh[lo:hi][-1] / bh[lo:hi][0] - 1) * 100) if hi > lo else 0.0
                ),
                "sharpe": round(sharpe, 2),
                "max_drawdown_pct": round(mdd * 100, 2),
            }

        mid = n_bars // 2
        segments = [
            _segment("Full range", 0, n_bars),
            _segment("First half", 0, mid),
            _segment("Second half", mid, n_bars),
        ]

        stride = max(1, n_bars // _MAX_CURVE_POINTS)
        curve = [
            {"timestamp": sim_times[i], "strategy": float(equity[i]), "buy_hold": float(bh[i])}
            for i in range(0, n_bars, stride)
        ]
        markers = [
            {"timestamp": x["timestamp"], "exit_timestamp": times[x["exit_i"]],
             "ret": float(x["ret"]), "side": x["side"]}
            for x in trades[:_MAX_TRADE_MARKERS]
        ]

        # Score series for the signal chart — bucket-max decimated so the
        # spikes that trigger entries survive.
        def _f(x: float) -> float | None:
            return None if np.isnan(x) else round(float(x), 3)

        ls = long_score[sim_slice]
        ss = short_score[sim_slice]
        pick = np.fmax(np.nan_to_num(ls, nan=-np.inf), np.nan_to_num(ss, nan=-np.inf))
        signal_curve = []
        for b in range(0, n_bars, stride):
            i = b + int(np.argmax(pick[b:b + stride]))
            signal_curve.append({
                "timestamp": sim_times[i],
                "long_score": _f(ls[i]),
                "short_score": _f(ss[i]),
            })

        return {
            **echo,
            "n_bars": n_bars,
            "long_entries": sim["long_entries"],
            "short_entries": sim["short_entries"],
            "exit_counts": sim["exit_counts"],
            "segments": segments,
            "equity_curve": curve,
            "trade_markers": markers,
            "signal_curve": signal_curve,
        }
