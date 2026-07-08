"""Retrospective swing/crest analysis over a simulation's klines.

Computes a battery of empirically-validated reversal signals from raw OHLCV
(no model forecast needed), combines them into one z-scored composite per
direction, and backtests a fixed-hold entry rule with fees. Anchored on a
simulation record purely for its coin/pair/timeframe/date-range — every
signal uses TRAILING data only (no lookahead); the hindsight swing labels
from the research scripts are deliberately not used here.

Signals (validated on BTC/ETH 15m–1h, 2019–2026):
  volume/range spike, wick pressure (6-bar), taker-flow tilt, participation
  swell (trade count), avg trade size, streak state, stretch (z vs SMA20),
  plus flags: volume divergence, deceleration, failed-breakout sweep.
Veto: an overbought top signal on heavy volume is a BREAKOUT, not a crest
(z20 > 2 with 2x volume continues upward, +20–26 bps/6 bars) — suppressed.
"""

from __future__ import annotations

import asyncio
import math
import random
import time
from datetime import UTC, datetime

import numpy as np
import pandas as pd
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.kline import Kline
from crypto_ai.database.models.kline_simulation import KlineSimulation
from crypto_ai.database.models.kline_simulation_prediction import KlineSimulationPrediction
from crypto_ai.services.kline_simulation_record import _interval_minutes

_TRAIL = 50    # trailing median window for relative (x-normal) features
_Z_WIN = 200   # trailing window for z-scoring each feature
_WICK_WIN = 6  # bars of wick pressure leading into a turn
_SWEEP_WIN = 12  # prior-extreme window for the failed-breakout sweep
_STRETCH_WIN = 20
_MAX_CURVE_POINTS = 1500
_MAX_TRADE_MARKERS = 1000
_FLAG_BONUS = 0.25  # composite bonus per confirming flag (sweep/voldiv/decel)

# Single-slot context cache (see _build_context): {key: (expires_monotonic, ctx)}.
_CTX_CACHE: dict[tuple, tuple[float, dict]] = {}
_CTX_TTL_S = 300.0

# Selectable composite members: z-scored components (equal-weight averaged)
# and binary confirming flags (+_FLAG_BONUS each). Keys are the API contract.
COMPONENT_KEYS = ("streak", "volume", "range", "trades", "avg_trade", "wick", "taker", "stretch")
FLAG_KEYS = ("sweep", "voldiv", "decel")
_COMPONENT_LABELS = {
    "streak": "Streak state",
    "volume": "Volume spike",
    "range": "Range spike",
    "trades": "Participation (trades)",
    "avg_trade": "Avg trade size",
    "wick": "Wick pressure",
    "taker": "Taker tilt",
    "stretch": "Stretch (z20)",
    "sweep": "Sweep (flag)",
    "voldiv": "Volume divergence (flag)",
    "decel": "Deceleration (flag)",
}


def _roll_rel(s: pd.Series, window: int = _TRAIL) -> np.ndarray:
    """value / trailing median — 'how many times normal is this bar'."""
    med = s.rolling(window).median().shift(1)
    return (s / med.where(med > 0)).to_numpy()


def _roll_z(x: np.ndarray, window: int = _Z_WIN) -> np.ndarray:
    """Trailing z-score of a feature (mean/std exclude the current bar)."""
    s = pd.Series(x)
    mu = s.rolling(window, min_periods=window // 2).mean().shift(1)
    sd = s.rolling(window, min_periods=window // 2).std().shift(1)
    return ((s - mu) / sd.where(sd > 0)).to_numpy()


def _signed_streak(r: np.ndarray) -> np.ndarray:
    out = np.zeros(len(r))
    run = 0.0
    for i, v in enumerate(r):
        if v > 0:
            run = run + 1 if run > 0 else 1
        elif v < 0:
            run = run - 1 if run < 0 else -1
        else:
            run = 0
        out[i] = run
    return out


def _t_stat(rets: list[float]) -> float:
    n = len(rets)
    if n < 2:
        return 0.0
    mu = sum(rets) / n
    var = sum((x - mu) ** 2 for x in rets) / (n - 1)
    sd = math.sqrt(var)
    return mu / (sd / math.sqrt(n)) if sd > 0 else 0.0


def _max_drawdown(equity: np.ndarray) -> float:
    peak = np.maximum.accumulate(equity)
    dd = equity / peak - 1.0
    return float(-dd.min()) if len(dd) else 0.0


def signal_covariate_series(
    o: np.ndarray, h: np.ndarray, low: np.ndarray, c: np.ndarray,
    vol: np.ndarray, ntr: np.ndarray, taker_buy: np.ndarray,
) -> dict[str, np.ndarray]:
    """Per-bar swing-signal features shaped for use as MODEL COVARIATES.

    The same empirically-validated signals the swing composite uses, exposed
    as raw series so a forecasting model (TimesFM XReg, …) can learn its own
    interactions instead of our hand-built equal-weight rule. All values are
    trailing-only (no lookahead) and roughly unit-scale/stationary (z-scores,
    fractions, bounded counts). NaN where trailing history is insufficient —
    callers should fill with 0.0 (= "no signal").
    """
    n = len(c)
    r = np.zeros(n)
    r[1:] = np.diff(np.log(np.maximum(c, 1e-12)))
    rng = np.maximum(h - low, 1e-12)
    taker = np.divide(taker_buy, vol, out=np.full(n, np.nan), where=vol > 0)
    avg_trade = np.divide(vol, np.maximum(ntr, 1), out=np.full(n, np.nan), where=ntr > 0)
    cs = pd.Series(c)
    sma = cs.rolling(_STRETCH_WIN).mean().shift(1)
    sd = cs.rolling(_STRETCH_WIN).std().shift(1)
    z20 = ((cs - sma) / sd.where(sd > 0)).to_numpy()
    return {
        "sig_volume": _roll_z(_roll_rel(pd.Series(vol))),
        "sig_range": _roll_z(_roll_rel(pd.Series(
            np.log(np.maximum(h, 1e-12) / np.maximum(low, 1e-12))))),
        "sig_trades": _roll_z(_roll_rel(pd.Series(ntr))),
        "sig_avg_trade": _roll_z(_roll_rel(pd.Series(avg_trade))),
        "sig_taker": taker - 0.5,  # centered: + = aggressive buyers dominate
        "sig_streak": np.clip(_signed_streak(r), -6, 6),
        "sig_stretch": np.clip(z20, -4.0, 4.0),
        "sig_upper_wick": (h - np.maximum(o, c)) / rng,
        "sig_lower_wick": (np.minimum(o, c) - low) / rng,
    }


class SwingAnalysisService:
    """Signal-composite swing backtest over a simulation's kline range."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def _build_context(self, scope: dict, *, min_bars: int) -> dict:
        """Fetch klines and compute every combo-INDEPENDENT series once.

        ``scope`` = {coin_id, quote_asset, interval, start_date, end_date} —
        the analysis is pure kline data; a simulation is never required.
        Shared by ``analyze`` (one combo) and ``optimize`` (hundreds of combos)
        — the DB fetch and feature computation dominate a single analysis, so
        the sweep must reuse them.

        The feature computation (seconds of pandas/numpy over up to ~1M bars)
        runs in a worker thread so the event loop — and with it every other
        request the app is serving — stays responsive. Contexts are also kept
        in a small TTL cache: interactive knob-tweaking fires a request per
        change, and only the first one per scope should pay the heavy part.
        """
        cache_key = (
            scope["coin_id"], scope["quote_asset"], scope["interval"],
            str(scope["start_date"]), str(scope["end_date"]),
        )
        cached = _CTX_CACHE.get(cache_key)
        if cached and cached[0] > time.monotonic():
            return cached[1]

        start_dt = datetime.combine(scope["start_date"], datetime.min.time(), tzinfo=UTC)
        end_dt = datetime.combine(scope["end_date"], datetime.max.time(), tzinfo=UTC)
        rows = (
            await self.session.execute(
                select(
                    Kline.open_time, Kline.open, Kline.high, Kline.low, Kline.close,
                    Kline.volume, Kline.number_of_trades, Kline.taker_buy_base_asset_volume,
                )
                .where(and_(
                    Kline.coin_id == scope["coin_id"],
                    Kline.quote_asset == scope["quote_asset"],
                    Kline.interval == scope["interval"],
                    Kline.open_time <= end_dt,
                    Kline.active.is_(True),
                ))
                .order_by(Kline.open_time)
            )
        ).all()
        if len(rows) < min_bars:
            return {"error": "Not enough kline history for swing analysis"}

        ctx = await asyncio.to_thread(self._compute_context, rows, start_dt)
        # Single-slot cache: contexts for long 5m ranges are ~100+ MB, so keep
        # exactly one (the scope the user is actively exploring).
        _CTX_CACHE.clear()
        _CTX_CACHE[cache_key] = (time.monotonic() + _CTX_TTL_S, ctx)
        return ctx

    @staticmethod
    def _compute_context(rows: list, start_dt: datetime) -> dict:
        """Sync feature computation — always call via ``asyncio.to_thread``."""
        n = len(rows)
        times = np.array([r[0] for r in rows])
        o = np.array([float(r[1]) for r in rows])
        h = np.array([float(r[2]) for r in rows])
        low = np.array([float(r[3]) for r in rows])
        c = np.array([float(r[4]) for r in rows])
        vol = np.array([float(r[5]) for r in rows])
        ntr = np.array([float(r[6]) for r in rows])
        taker = np.divide(
            np.array([float(r[7]) for r in rows]), vol,
            out=np.full(n, np.nan), where=vol > 0,
        )

        # ── Features (all trailing-only) ────────────────────────────────────
        r = np.zeros(n)
        r[1:] = np.diff(np.log(np.maximum(c, 1e-12)))
        streak = _signed_streak(r)
        rng = np.maximum(h - low, 1e-12)
        rel_vol = _roll_rel(pd.Series(vol))
        rel_range = _roll_rel(pd.Series(np.log(np.maximum(h, 1e-12) / np.maximum(low, 1e-12))))
        rel_trades = _roll_rel(pd.Series(ntr))
        avg_trade = np.divide(vol, ntr, out=np.full(n, np.nan), where=ntr > 0)
        rel_avg_trade = _roll_rel(pd.Series(avg_trade))
        upper_wick = (h - np.maximum(o, c)) / rng
        lower_wick = (np.minimum(o, c) - low) / rng
        uw6 = pd.Series(upper_wick).rolling(_WICK_WIN).mean().to_numpy()
        lw6 = pd.Series(lower_wick).rolling(_WICK_WIN).mean().to_numpy()
        cs = pd.Series(c)
        sma = cs.rolling(_STRETCH_WIN).mean().shift(1)
        sd = cs.rolling(_STRETCH_WIN).std().shift(1)
        z20 = ((cs - sma) / sd.where(sd > 0)).to_numpy()
        sma_arr = sma.to_numpy()  # known-at-open mean level (mean-touch TP)

        # Confirming flags
        ups3 = (r > 0) & (np.roll(r, 1) > 0) & (np.roll(r, 2) > 0)
        dns3 = (r < 0) & (np.roll(r, 1) < 0) & (np.roll(r, 2) < 0)
        ups3[:2] = dns3[:2] = False
        voldiv_up = ups3 & (vol < np.roll(vol, 2))
        voldiv_dn = dns3 & (vol < np.roll(vol, 2))
        decel_up = ups3 & (r < np.roll(r, 1)) & (np.roll(r, 1) < np.roll(r, 2))
        decel_dn = dns3 & (np.abs(r) < np.abs(np.roll(r, 1))) \
            & (np.abs(np.roll(r, 1)) < np.abs(np.roll(r, 2)))
        prior_high = pd.Series(h).rolling(_SWEEP_WIN).max().shift(1).to_numpy()
        prior_low = pd.Series(low).rolling(_SWEEP_WIN).min().shift(1).to_numpy()
        sweep_high = (h > prior_high) & (c < prior_high)
        sweep_low = (low < prior_low) & (c > prior_low)

        # z-scored components, direction-aware, keyed by their API name.
        z_vol = _roll_z(rel_vol)
        z_range = _roll_z(rel_range)
        z_trades = _roll_z(rel_trades)
        z_avg_trade = _roll_z(rel_avg_trade)
        z_uw6 = _roll_z(uw6)
        z_lw6 = _roll_z(lw6)
        z_taker = _roll_z(taker)
        z_streak = _roll_z(streak)
        stretch = np.clip(z20, -3.0, 3.0)  # already a z — clip, don't re-score

        in_range = np.array([t >= start_dt for t in times])
        first = int(np.argmax(in_range)) if in_range.any() else n

        return {
            "n": n,
            "first": first,  # first bar inside the sim's date range
            "times": times,
            "h": h,
            "low": low,
            "c": c,
            "z20": z20,
            "sma_arr": sma_arr,
            "prior_high": prior_high,
            "prior_low": prior_low,
            # 14-bar average bar range through the PRIOR bar (ATR/trailing stops).
            "atr": pd.Series(h - low).rolling(14).mean().shift(1).to_numpy(),
            # Raw series — used by the scalp strategies (VWAP, streak
            # reversion, taker-flow imbalance).
            "vol": vol,
            "streak": streak,
            "taker_ratio": taker,
            "top_components": {
                "streak": z_streak, "volume": z_vol, "range": z_range, "trades": z_trades,
                "avg_trade": z_avg_trade, "wick": z_uw6, "taker": z_taker, "stretch": stretch,
            },
            "bottom_components": {
                "streak": -z_streak, "volume": z_vol, "range": z_range, "trades": z_trades,
                "avg_trade": z_avg_trade, "wick": z_lw6, "taker": -z_taker, "stretch": -stretch,
            },
            "top_flags": {"sweep": sweep_high, "voldiv": voldiv_up, "decel": decel_up},
            "bottom_flags": {"sweep": sweep_low, "voldiv": voldiv_dn, "decel": decel_dn},
            # Breakout veto: overbought on heavy volume CONTINUES — never fade it.
            "veto_top": (z20 > 2.0) & (rel_vol > 2.0),
        }

    @staticmethod
    def _composite_scores(
        ctx: dict, enabled: set[str], weights: dict[str, float]
    ) -> tuple[np.ndarray, np.ndarray]:
        """(bottom_score, top_score) for a component subset + weight map."""

        def _composite(
            components: dict[str, np.ndarray], flags: dict[str, np.ndarray]
        ) -> np.ndarray:
            keys = [k for k in components if k in enabled]
            stack = np.vstack([components[k] for k in keys])
            weighted = np.vstack([components[k] * weights.get(k, 1.0) for k in keys])
            valid = np.sum(~np.isnan(stack), axis=0)
            with np.errstate(invalid="ignore"):
                # Weighted sum over the PLAIN valid count: all-1.0 weights
                # reproduce the equal-weight nanmean exactly.
                score = np.nansum(weighted, axis=0) / np.maximum(valid, 1)
            # Require (nearly) all selected components present at the bar.
            score[valid < max(1, len(keys) - 2)] = np.nan
            for k, f in flags.items():
                if k in enabled:
                    score = score + _FLAG_BONUS * weights.get(k, 1.0) * f.astype(float)
            return score

        return (
            _composite(ctx["bottom_components"], ctx["bottom_flags"]),
            _composite(ctx["top_components"], ctx["top_flags"]),
        )

    @staticmethod
    def _run_trades(
        ctx: dict,
        bottom_score: np.ndarray,
        top_score: np.ndarray,
        *,
        threshold: float,
        hold_bars: int,
        fee_bps: float,
        side: str,
        sl_mode: str,
        sl_value: float,
        tp_mode: str,
        tp_value: float,
        prob_by_time: dict,
    ) -> dict:
        """Non-overlapping backtest with SL / TP exits, capped at hold_bars.

        Intra-bar level exits (stops/targets) assume the order fills at the
        level — the same idealization the fee model already makes. When both
        a stop and a target could fill in one bar, the STOP wins
        (conservative: the intra-bar path is unknowable from OHLC).
        """
        n = ctx["n"]
        times = ctx["times"]
        h = ctx["h"]
        low = ctx["low"]
        c = ctx["c"]
        atr = ctx["atr"]
        prior_high = ctx["prior_high"]
        prior_low = ctx["prior_low"]
        sma_arr = ctx["sma_arr"]
        veto_top = ctx["veto_top"]
        fee_rt = fee_bps / 1e4
        allow_long = side in ("long", "both")
        allow_short = side in ("short", "both")
        model_available = bool(prob_by_time)

        strat_ret = np.zeros(n)  # per-bar strategy returns (fees included)
        trades: list[dict] = []
        long_entries = short_entries = vetoed_tops = 0
        exit_counts = {"stop": 0, "take_profit": 0, "reversal": 0, "hold_max": 0}
        t = ctx["first"]
        while t <= n - 2:  # need at least one bar after entry
            direction = 0
            b, tp = bottom_score[t], top_score[t]
            if allow_long and not np.isnan(b) and b >= threshold:
                direction = 1
            elif allow_short and not np.isnan(tp) and tp >= threshold:
                if veto_top[t]:
                    vetoed_tops += 1
                    t += 1
                    continue
                direction = -1
            if direction == 0:
                t += 1
                continue
            if model_available:
                p = prob_by_time.get(times[t + 1])
                disagrees = p is not None and (
                    (direction == 1 and p < 0.5) or (direction == -1 and p > 0.5)
                )
                if disagrees:
                    t += 1
                    continue

            entry = c[t]
            # Stop level (static modes; the trailing mode recomputes per bar).
            sl_level: float | None = None
            if sl_mode == "pct":
                sl_level = entry * (1.0 - direction * sl_value / 100.0)
            elif sl_mode == "atr" and atr[t] > 0:
                sl_level = entry - direction * sl_value * atr[t]
            elif sl_mode == "structure":
                # Prior 12-bar extreme on the LOSING side of entry. A
                # capitulation bar can close beyond the prior extreme, putting
                # the level on the winning side — that's not a stop, skip it.
                lvl = prior_low[t] if direction == 1 else prior_high[t]
                if not np.isnan(lvl) and (entry - lvl) * direction > 0:
                    sl_level = float(lvl)
            trailing = sl_mode == "trail_atr" and atr[t] > 0
            # Static take-profit level (reversal/mean modes are checked per bar).
            tp_level: float | None = None
            if tp_mode == "pct":
                tp_level = entry * (1.0 + direction * tp_value / 100.0)
            elif tp_mode == "resistance":
                # Prior 12-bar extreme = the nearest known ceiling (floor for
                # shorts). Skipped when entry is already beyond it.
                lvl = prior_high[t] if direction == 1 else prior_low[t]
                if not np.isnan(lvl) and (lvl - entry) * direction > 0:
                    tp_level = float(lvl)

            best = entry  # best close in the trade's favor (trailing stop anchor)
            exit_i = min(t + hold_bars, n - 1)
            exit_price = c[exit_i]
            reason = "hold_max"
            for j in range(t + 1, min(t + hold_bars, n - 1) + 1):
                if trailing:
                    sl_level = best - direction * sl_value * atr[t]
                if sl_level is not None:
                    sl_hit = (low[j] <= sl_level) if direction == 1 else (h[j] >= sl_level)
                    if sl_hit:
                        exit_i, exit_price, reason = j, float(sl_level), "stop"
                        break
                if tp_level is not None:
                    tp_hit = (h[j] >= tp_level) if direction == 1 else (low[j] <= tp_level)
                    if tp_hit:
                        exit_i, exit_price, reason = j, float(tp_level), "take_profit"
                        break
                if tp_mode == "mean" and not np.isnan(sma_arr[j]):
                    lvl = float(sma_arr[j])
                    touched = (h[j] >= lvl) if direction == 1 else (low[j] <= lvl)
                    if touched and (lvl - entry) * direction > 0:
                        exit_i, exit_price, reason = j, lvl, "take_profit"
                        break
                if tp_mode == "reversal":
                    opp = top_score[j] if direction == 1 else bottom_score[j]
                    # A vetoed top is momentum, not a reversal — don't exit a
                    # long into an upward breakout.
                    opp_veto = direction == 1 and veto_top[j]
                    if not np.isnan(opp) and opp >= threshold and not opp_veto:
                        exit_i, exit_price, reason = j, c[j], "reversal"
                        break
                if direction * (c[j] - best) > 0:
                    best = c[j]

            ret = direction * (exit_price / entry - 1.0) - fee_rt
            trades.append({"i": t, "exit_i": exit_i, "timestamp": times[t],
                           "ret": ret, "side": "long" if direction == 1 else "short",
                           "exit_reason": reason})
            exit_counts[reason] += 1
            # Per-bar returns: close-to-close inside the hold, level-to-prior-
            # close on the exit bar; fee halves at the entry and exit fills.
            for j in range(t + 1, exit_i + 1):
                px = exit_price if j == exit_i else c[j]
                strat_ret[j] += direction * (px / c[j - 1] - 1.0)
            strat_ret[t + 1] -= fee_rt / 2
            strat_ret[exit_i] -= fee_rt / 2
            long_entries += direction == 1
            short_entries += direction == -1
            t = exit_i  # non-overlapping: next decision at the exit bar's close

        return {
            "trades": trades,
            "strat_ret": strat_ret,
            "long_entries": long_entries,
            "short_entries": short_entries,
            "vetoed_tops": vetoed_tops,
            "exit_counts": exit_counts,
        }

    # ── Auto-optimizer ────────────────────────────────────────────────────────

    # Bounded, curated sweep — NOT the full cartesian space of the tab's knobs.
    # Weights are deliberately excluded (a continuous 11-dim space is pure
    # overfitting surface); component subsets are limited to three motivated
    # families.
    _OPT_THRESHOLDS = (0.5, 0.75, 1.0, 1.5)
    _OPT_HOLDS = (3, 6, 12)
    _OPT_SIDES = ("long", "both")
    _OPT_SLS = (("none", 2.0), ("atr", 2.0), ("trail_atr", 2.0))
    _OPT_TPS = (("none", 3.0), ("resistance", 3.0), ("mean", 3.0))
    _OPT_SUBSETS: dict[str, tuple[str, ...]] = {
        "all": COMPONENT_KEYS + FLAG_KEYS,
        # Climax detection: participation/violence spikes + confirming flags.
        "spikes": ("volume", "range", "trades", "avg_trade", "sweep", "voldiv"),
        # Directional exhaustion: who is pushing, how stretched, how tired.
        "direction": ("streak", "wick", "taker", "stretch", "sweep", "decel"),
    }

    async def _load_probs(self, confirm_sim_id: str | None) -> dict:
        """prob_up per timestamp from a simulation's stored forecasts (or {})."""
        if not confirm_sim_id:
            return {}
        rec = (
            await self.session.execute(
                select(KlineSimulation).where(KlineSimulation.id == confirm_sim_id)
            )
        ).scalar_one_or_none()
        if not rec:
            return {}
        model_name = (rec.models or [None])[0]
        pred_rows = (
            await self.session.execute(
                select(KlineSimulationPrediction.timestamp, KlineSimulationPrediction.prob_up)
                .where(and_(
                    KlineSimulationPrediction.simulation_id == confirm_sim_id,
                    KlineSimulationPrediction.model_name == model_name,
                    KlineSimulationPrediction.prob_up.isnot(None),
                ))
            )
        ).all()
        return {t: p for t, p in pred_rows}

    async def _sim_scope(self, sim_id: str) -> dict | None:
        """Resolve a simulation record to its coin/pair/timeframe/range scope."""
        rec = (
            await self.session.execute(
                select(KlineSimulation).where(KlineSimulation.id == sim_id)
            )
        ).scalar_one_or_none()
        if not rec:
            return None
        return {
            "coin_id": rec.coin_id,
            "quote_asset": rec.quote_asset,
            "interval": rec.interval,
            "start_date": rec.start_date,
            "end_date": rec.end_date,
        }

    async def analyze_sim(self, sim_id: str, *, use_model: bool = False, **knobs) -> dict | None:
        """Back-compat wrapper: analyze a simulation's scope (the sim only
        anchors coin/pair/timeframe/range; with use_model its stored forecasts
        confirm entries)."""
        scope = await self._sim_scope(sim_id)
        if scope is None:
            return None
        return await self.analyze(
            scope, confirm_sim_id=sim_id if use_model else None, **knobs
        )

    async def optimize_sim(self, sim_id: str, *, use_model: bool = False, **knobs) -> dict | None:
        """Back-compat wrapper mirroring ``analyze_sim`` for the sweep."""
        scope = await self._sim_scope(sim_id)
        if scope is None:
            return None
        return await self.optimize(
            scope, confirm_sim_id=sim_id if use_model else None, **knobs
        )

    async def optimize(
        self,
        scope: dict,
        *,
        confirm_sim_id: str | None = None,
        fee_bps: float = 4.0,
        time_budget_s: float = 90.0,
    ) -> dict | None:
        """Sweep the curated combo grid; tune on the FIRST half, judge on the second.

        Combos are ranked by their train-half edge t-statistic (significance-
        aware, so ten lucky trades don't beat forty solid ones) and reported
        with their untouched validation-half stats alongside. Underpopulated
        combos (train < 10 trades or validation < 3) are dropped. The grid is
        shuffled deterministically so a time-budget cutoff still samples the
        whole space rather than one corner.
        """
        ctx = await self._build_context(scope, min_bars=_Z_WIN + max(self._OPT_HOLDS) + 10)
        if "error" in ctx:
            return ctx

        prob_by_time = await self._load_probs(confirm_sim_id)

        # The sweep (hundreds of trade-loop passes) runs in a worker thread so
        # the event loop — and every other request — stays responsive.
        result = await asyncio.to_thread(
            self._optimize_sync, ctx, prob_by_time, fee_bps, time_budget_s
        )
        result["use_model"] = confirm_sim_id is not None
        result["model_available"] = bool(prob_by_time)
        return result

    def _optimize_sync(
        self, ctx: dict, prob_by_time: dict, fee_bps: float, time_budget_s: float
    ) -> dict:
        """Sync sweep body — always call via ``asyncio.to_thread``."""
        n = ctx["n"]
        first = ctx["first"]
        mid = first + (n - first) // 2  # train = [first, mid), validation = [mid, n)

        # Composite scores depend only on the subset — compute each pair once.
        scores_by_subset = {
            name: self._composite_scores(ctx, set(keys), {})
            for name, keys in self._OPT_SUBSETS.items()
        }

        combos = [
            {"threshold": th, "hold_bars": hb, "side": sd,
             "sl_mode": sl[0], "sl_value": sl[1], "tp_mode": tp[0], "tp_value": tp[1],
             "subset": sub}
            for th in self._OPT_THRESHOLDS
            for hb in self._OPT_HOLDS
            for sd in self._OPT_SIDES
            for sl in self._OPT_SLS
            for tp in self._OPT_TPS
            for sub in self._OPT_SUBSETS
        ]
        random.Random(42).shuffle(combos)

        def _stats(trades: list[dict], strat_ret: np.ndarray, lo: int, hi: int) -> dict:
            sub = [x for x in trades if lo <= x["i"] < hi]
            rets = [x["ret"] for x in sub]
            seg = strat_ret[lo:hi]
            total = float((np.cumprod(1.0 + seg)[-1] - 1.0) * 100) if len(seg) else 0.0
            return {
                "n_trades": len(sub),
                "win_rate_pct": (sum(1 for x in rets if x > 0) / len(rets) * 100) if rets else 0.0,
                "avg_net_bps": (sum(rets) / len(rets) * 1e4) if rets else 0.0,
                "edge_t": round(_t_stat(rets), 2),
                "total_return_pct": round(total, 2),
            }

        results = []
        evaluated = 0
        started = time.monotonic()
        partial = False
        for combo in combos:
            if time.monotonic() - started > time_budget_s:
                partial = True
                break
            bottom_score, top_score = scores_by_subset[combo["subset"]]
            sim = self._run_trades(
                ctx, bottom_score, top_score,
                threshold=combo["threshold"], hold_bars=combo["hold_bars"],
                fee_bps=fee_bps, side=combo["side"],
                sl_mode=combo["sl_mode"], sl_value=combo["sl_value"],
                tp_mode=combo["tp_mode"], tp_value=combo["tp_value"],
                prob_by_time=prob_by_time,
            )
            evaluated += 1
            train = _stats(sim["trades"], sim["strat_ret"], first, mid)
            val = _stats(sim["trades"], sim["strat_ret"], mid, n)
            if train["n_trades"] < 10 or val["n_trades"] < 3:
                continue
            results.append({
                "threshold": combo["threshold"],
                "hold_bars": combo["hold_bars"],
                "side": combo["side"],
                "sl_mode": combo["sl_mode"],
                "sl_value": combo["sl_value"],
                "tp_mode": combo["tp_mode"],
                "tp_value": combo["tp_value"],
                "signals": list(self._OPT_SUBSETS[combo["subset"]]),
                "train": train,
                "val": val,
                "full": _stats(sim["trades"], sim["strat_ret"], first, n),
            })

        results.sort(key=lambda x: (x["train"]["edge_t"], x["train"]["avg_net_bps"]), reverse=True)
        # use_model / model_available are stamped by the async wrapper.
        return {
            "evaluated": evaluated,
            "total_combos": len(combos),
            "partial": partial,
            "fee_bps": fee_bps,
            "split_at": ctx["times"][mid] if mid < n else ctx["times"][-1],
            "results": results[:12],
        }

    async def analyze(
        self,
        scope: dict,
        *,
        confirm_sim_id: str | None = None,
        threshold: float = 1.0,
        hold_bars: int = 6,
        fee_bps: float = 8.0,
        side: str = "long",
        signals: set[str] | None = None,
        sl_mode: str = "none",
        sl_value: float = 2.0,
        tp_mode: str = "none",
        tp_value: float = 3.0,
        weights: dict[str, float] | None = None,
    ) -> dict | None:
        if sl_mode not in ("none", "pct", "atr", "structure", "trail_atr"):
            return {"error": f"Unknown sl_mode: {sl_mode}"}
        if tp_mode not in ("none", "pct", "resistance", "reversal", "mean"):
            return {"error": f"Unknown tp_mode: {tp_mode}"}
        # Which composite members participate. None/empty = all.
        enabled = set(signals) if signals else set(COMPONENT_KEYS) | set(FLAG_KEYS)
        unknown = enabled - set(COMPONENT_KEYS) - set(FLAG_KEYS)
        if unknown:
            return {"error": f"Unknown signal keys: {', '.join(sorted(unknown))}"}
        if not (enabled & set(COMPONENT_KEYS)):
            return {
                "error": "Enable at least one signal component (flags alone can't form a composite)"
            }
        # Per-member contribution multipliers (1.0 = the equal-weight baseline).
        # The composite denominator stays the plain count of valid components,
        # so 2.0 exactly doubles that signal's contribution and 0.0 mutes it
        # while still diluting the average — unticking removes it entirely.
        weights = dict(weights or {})
        unknown_w = set(weights) - set(COMPONENT_KEYS) - set(FLAG_KEYS)
        if unknown_w:
            return {"error": f"Unknown weight keys: {', '.join(sorted(unknown_w))}"}
        if any(not (0.0 <= w <= 5.0) for w in weights.values()):
            return {"error": "Signal weights must be between 0% and 500%"}

        ctx = await self._build_context(scope, min_bars=_Z_WIN + hold_bars + 10)
        if "error" in ctx:
            return ctx
        n = ctx["n"]
        times = ctx["times"]
        c = ctx["c"]
        top_components = ctx["top_components"]
        bottom_components = ctx["bottom_components"]
        top_flags = ctx["top_flags"]
        bottom_flags = ctx["bottom_flags"]

        # TOP (fade into short): up-streak, spikes, upper-wick pressure,
        # buyer-dominant taker flow, upward stretch. BOTTOM mirrors it.
        # Off-loop: over ~1M bars the composite + the Python trade loop take
        # seconds and would otherwise freeze every request the app is serving.
        bottom_score, top_score = await asyncio.to_thread(
            self._composite_scores, ctx, enabled, weights
        )

        # Optional model confirmation from a simulation's stored forecasts:
        # require the next bar's prob_up to agree with the trade direction.
        prob_by_time = await self._load_probs(confirm_sim_id)
        model_available = bool(prob_by_time)

        sim = await asyncio.to_thread(
            self._run_trades,
            ctx, bottom_score, top_score,
            threshold=threshold, hold_bars=hold_bars, fee_bps=fee_bps, side=side,
            sl_mode=sl_mode, sl_value=sl_value, tp_mode=tp_mode, tp_value=tp_value,
            prob_by_time=prob_by_time,
        )
        first = ctx["first"]
        fee_rt = fee_bps / 1e4
        trades = sim["trades"]
        strat_ret = sim["strat_ret"]
        long_entries = sim["long_entries"]
        short_entries = sim["short_entries"]
        vetoed_tops = sim["vetoed_tops"]
        exit_counts = sim["exit_counts"]

        bar_ret = np.zeros(n)
        bar_ret[1:] = c[1:] / c[:-1] - 1.0
        sim_slice = slice(first, n)
        equity = np.cumprod(1.0 + strat_ret[sim_slice])
        bh = np.cumprod(1.0 + bar_ret[sim_slice]) * (1.0 - fee_rt)
        sim_times = times[sim_slice]
        n_bars = len(equity)

        minutes = _interval_minutes(scope["interval"])
        periods_per_year = max(1, int(365 * 24 * 60 / minutes))

        def _segment(label: str, lo: int, hi: int) -> dict:
            seg_tr = [x for x in trades if lo + first <= x["i"] < hi + first]
            rets = [x["ret"] for x in seg_tr]
            eq = equity[lo:hi]
            sr = strat_ret[sim_slice][lo:hi]
            sharpe = 0.0
            if len(sr) > 1 and np.std(sr) > 0:
                sharpe = float(np.mean(sr) / np.std(sr) * math.sqrt(periods_per_year))
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
                "max_drawdown_pct": round(_max_drawdown(eq) * 100, 2),
            }

        mid = n_bars // 2
        segments = [
            _segment("Full range", 0, n_bars),
            _segment("First half", 0, mid),
            _segment("Second half", mid, n_bars),
        ]

        # Per-signal diagnostics: each member's mean CONTRIBUTION at the bars
        # actually entered on — direction-aware, so positive always means
        # "pushed the composite toward this entry". Disabled members are still
        # measured (marked enabled=false) so their would-be state is visible.
        long_idx = [x["i"] for x in trades if x["side"] == "long"]
        short_idx = [x["i"] for x in trades if x["side"] == "short"]
        diag = []
        for key in COMPONENT_KEYS:
            vals = list(bottom_components[key][long_idx]) + list(top_components[key][short_idx])
            vals = [v for v in vals if not np.isnan(v)]
            diag.append({
                "key": key,
                "name": _COMPONENT_LABELS[key],
                "enabled": key in enabled,
                "weight": weights.get(key, 1.0),
                "mean_z_at_entry": round(float(np.mean(vals)), 2) if vals else None,
            })
        for key in FLAG_KEYS:
            vals = list(bottom_flags[key][long_idx]) + list(top_flags[key][short_idx])
            diag.append({
                "key": key,
                "name": _COMPONENT_LABELS[key],
                "enabled": key in enabled,
                "weight": weights.get(key, 1.0),
                # For flags: the fraction of entries where the flag was firing.
                "mean_z_at_entry": round(float(np.mean(vals)), 2) if vals else None,
            })

        stride = max(1, n_bars // _MAX_CURVE_POINTS)
        curve = [
            {"timestamp": sim_times[i], "strategy": float(equity[i]), "buy_hold": float(bh[i])}
            for i in range(0, n_bars, stride)
        ]
        markers = [
            {
                "timestamp": x["timestamp"],
                # Actual exit bar (stop/target/reversal or the hold-max cap),
                # so the UI can shade each trade's in-market window.
                "exit_timestamp": times[x["exit_i"]],
                "ret": float(x["ret"]),
                "side": x["side"],
            }
            for x in trades[:_MAX_TRADE_MARKERS]
        ]

        # Per-bar composite + component values for charting. Decimation keeps
        # each bucket's STRONGEST bar (max of either composite) — a blind
        # stride would sample away exactly the spikes that trigger entries.
        # Component values are direction-aware contributions for the traded
        # side (long/bottom unless side == "short").
        comp_side = {
            k: v[sim_slice]
            for k, v in (top_components if side == "short" else bottom_components).items()
        }

        def _f(x: float) -> float | None:
            return None if np.isnan(x) else round(float(x), 3)

        long_s = bottom_score[sim_slice]
        short_s = top_score[sim_slice]
        pick = np.fmax(np.nan_to_num(long_s, nan=-np.inf), np.nan_to_num(short_s, nan=-np.inf))
        signal_curve = []
        for b in range(0, n_bars, stride):
            seg = pick[b:b + stride]
            i = b + int(np.argmax(seg))
            point = {
                "timestamp": sim_times[i],
                "long_score": _f(long_s[i]),
                "short_score": _f(short_s[i]),
            }
            for key in COMPONENT_KEYS:
                point[key] = _f(comp_side[key][i])
            signal_curve.append(point)

        return {
            "threshold": threshold,
            "hold_bars": hold_bars,
            "fee_bps": fee_bps,
            "side": side,
            "sl_mode": sl_mode,
            "sl_value": sl_value,
            "tp_mode": tp_mode,
            "tp_value": tp_value,
            "weights": weights,
            "exit_counts": exit_counts,
            "use_model": confirm_sim_id is not None,
            "model_available": model_available,
            "n_bars": n_bars,
            "long_entries": long_entries,
            "short_entries": short_entries,
            "vetoed_tops": vetoed_tops,
            "segments": segments,
            "signals": diag,
            "equity_curve": curve,
            "trade_markers": markers,
            "signal_curve": signal_curve,
            "components_side": "short" if side == "short" else "long",
        }
