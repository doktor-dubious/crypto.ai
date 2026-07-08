"""Service for persisted kline simulation records (master/detail listing)."""

from __future__ import annotations

import bisect
import math
from datetime import UTC, date, datetime

from sqlalchemy import and_, case, func, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.kline_simulation import KlineSimulation
from crypto_ai.database.models.kline_simulation_prediction import KlineSimulationPrediction
from crypto_ai.schemas.kline_simulation import KlineSimulationUpdate

# Derived (non-stored) columns used for the direction-comparison view.
_ACTUAL_DIR = KlineSimulationPrediction.actual - KlineSimulationPrediction.prev_close
_MODEL_DIR = KlineSimulationPrediction.predicted - KlineSimulationPrediction.prev_close
# Rank for the up-call hit/miss column: hit=2, miss=1, no-call=0.
_DIRECTION_RANK = case(
    (and_(_MODEL_DIR > 0, _ACTUAL_DIR > 0), 2),
    (and_(_MODEL_DIR > 0, _ACTUAL_DIR < 0), 1),
    else_=0,
)

_PRED_SORT_COLUMNS = {
    "timestamp": KlineSimulationPrediction.timestamp,
    "model_name": KlineSimulationPrediction.model_name,
    "actual": KlineSimulationPrediction.actual,
    "predicted": KlineSimulationPrediction.predicted,
    "actual_direction": _ACTUAL_DIR,
    "model_direction": _MODEL_DIR,
    "direction": _DIRECTION_RANK,
    "error": KlineSimulationPrediction.error,
    "pct_error": KlineSimulationPrediction.pct_error,
    "prob_up": KlineSimulationPrediction.prob_up,
    "in_interval": KlineSimulationPrediction.in_interval,
}

# Which forecast value drives Predicted / Predicted-Direction / Direction: the
# point forecast, or one of the lower quantiles (P10..P50, indices 0..4).
_QUANTILE_IDX = {"q10": 0, "q20": 1, "q30": 2, "q40": 3, "q50": 4}


def _forecast_expr(forecast: str | None):
    """SQL expression for the chosen forecast value (point or a quantile)."""
    idx = _QUANTILE_IDX.get(forecast or "")
    if idx is None:
        return KlineSimulationPrediction.predicted
    return KlineSimulationPrediction.quantiles[idx].as_float()


def _interval_minutes(interval: str) -> int:
    """Minutes per bar for an interval string like '1h', '15m', '1d', '1M'.

    Binance uses lowercase 'm' for minutes and uppercase 'M' for months, so
    the month check must happen before lowercasing.
    """
    s = (interval or "1h").strip()
    if s.endswith("M"):  # monthly (e.g. '1M') — ~30 days per bar
        num = "".join(ch for ch in s if ch.isdigit()) or "1"
        return int(num) * 43200
    s = s.lower()
    units = {"m": 1, "h": 60, "d": 1440, "w": 10080}
    num = "".join(ch for ch in s if ch.isdigit()) or "1"
    unit = "".join(ch for ch in s if ch.isalpha()) or "h"
    return int(num) * units.get(unit, 60)


_VOL_WINDOW = 20  # trailing bars for the vol-breakout expansion baseline
_CONVICTION_FLOOR = 0.1  # smallest size a barely-qualifying signal still takes


def _compute_backtest(
    rows: list[tuple],
    threshold: float,
    fee_bps: float,
    min_edge_pct: float,
    periods_per_year: int,
    strategy: str = "price",
    vol_mode: str | None = None,
    cover_fees: bool = False,
    position_sizing: str = "none",
    pyramid_steps: int = 4,
    allow_short: bool = False,
) -> dict:
    """Fee-aware backtest of a confidence-thresholded signal (long, or long/short).

    rows: (timestamp, prev_close, actual, predicted, prob_up, quantiles, pred_vol)
    by time. The base signal goes long for the next bar when prob_up >= threshold
    (and, if min_edge_pct>0, the point forecast clears prev_close by that margin).
    When ``cover_fees`` is set, the round-trip fee (2 * fee_side) is added to that
    required edge, so a bar only trades when its forecast move is expected to come
    out ahead after costs.
    Fees are charged per side only when the position *changes*, so consecutive
    same-direction bars aren't double-charged.

    When ``allow_short`` is set, the signal is symmetric: a bar goes SHORT for the
    next bar when ``prob_up <= 1 - threshold`` (and, with min_edge/cover_fees, the
    point forecast falls below prev_close by the required margin). A short profits
    when price drops. NOTE: the fee model is symmetric (same per-side fee for longs
    and shorts, matching Binance's commission), but it does NOT model the carrying
    cost that real shorts incur — perpetual-futures funding or margin borrow
    interest — so short results here are optimistic by that (regime-dependent)
    amount. Flipping long↔short pays both sides' fee (close + open) as one change.

    When ``strategy == "price_volatility"`` a per-bar volatility proxy is used:
    the genuine one-step volatility forecast ``pred_vol`` when present, else the
    predicted 80% band width (P90 − P10, relative to prev_close):
      • "vol_targeting" sizes each long inversely to predicted vol (calm bars get
        up to full size, violent bars get scaled down), so position is a float in
        [0, 1] rather than 0/1.
      • "vol_breakout" only takes the long when predicted vol exceeds its trailing
        average (a vol expansion) — otherwise it stays flat.

    ``position_sizing`` applies a size factor on top of the above, in (0, 1]:
      • "conviction": size scales with how far prob_up clears the threshold.
      • "pyramiding": size ramps up over consecutive qualifying bars (adding to a
        winner), reaching full size after ``pyramid_steps`` bars.
    ("none" keeps full size on every signal — the original behaviour.)

    Returns metrics plus the (downsampled) equity curves.
    """
    fee_side = (fee_bps / 2.0) / 10_000.0
    min_edge = min_edge_pct / 100.0
    # Required edge before going long: the manual min-edge, plus the full
    # round-trip fee when cover_fees is on (so the expected gross move must
    # cover the cost of entering and exiting the trade).
    edge = min_edge + (2.0 * fee_side if cover_fees else 0.0)
    n = len(rows)
    if n == 0:
        return {"n_bars": 0}

    is_vol = strategy == "price_volatility"

    # Per-bar volatility proxy: the genuine vol forecast (pred_vol) if available,
    # otherwise the predicted band width (P90 − P10) / prev_close. Both modes use
    # it only as a ratio to its own median / trailing average, so scale is moot.
    spread_rel: list[float | None] = []
    bar_ret: list[float] = []
    base_long: list[bool] = []
    base_short: list[bool] = []
    pu_list: list[float] = []
    used_pred_vol = False
    for _ts, prev, act, pred, pu, q, pv in rows:
        prev = float(prev); act = float(act); pred = float(pred); pu = float(pu)
        bar_ret.append((act - prev) / prev if prev else 0.0)
        pu_list.append(pu)
        base_long.append(pu >= threshold and (edge <= 0 or pred >= prev * (1 + edge)))
        base_short.append(
            allow_short and pu <= 1 - threshold and (edge <= 0 or pred <= prev * (1 - edge))
        )
        if pv is not None:
            spread_rel.append(float(pv)); used_pred_vol = True
        elif q and len(q) >= 2 and prev:
            spread_rel.append((float(q[-1]) - float(q[0])) / prev)
        else:
            spread_rel.append(None)

    # Per-bar desired direction: +1 long, -1 short, 0 flat. With threshold >= 0.5
    # the long/short conditions are mutually exclusive; long wins any tie at 0.5.
    sig = [1 if base_long[i] else (-1 if base_short[i] else 0) for i in range(n)]

    # Target vol for sizing = expanding median of the predicted spreads seen so
    # far. A whole-series median would leak future bars' forecasts into earlier
    # sizing decisions (look-ahead bias), so the target at bar i only uses
    # spreads up to and including bar i (each bar's own spread is a forecast
    # known at decision time).
    target_vols: list[float | None] = []
    _seen: list[float] = []
    for s in spread_rel:
        if s is not None and s > 0:
            bisect.insort(_seen, s)
        target_vols.append(_seen[len(_seen) // 2] if _seen else None)

    # Per-bar size factor in (0, 1] from the position-sizing scheme, applied on
    # top of whatever size the (vol) signal decides. "none" keeps full size.
    #   • conviction: scale with how far prob_up clears the threshold.
    #   • pyramiding: ramp up over consecutive qualifying bars (add to a winner).
    size_factors = [1.0] * n
    if position_sizing == "conviction":
        # pu is effectively capped at 0.9, so normalise the clearance over
        # (0.9 - threshold); a barely-qualifying signal still takes a floor size.
        # For shorts, conviction is how far prob_DOWN (1 - pu) clears threshold.
        denom = max(0.9 - threshold, 0.05)
        for i in range(n):
            if sig[i] == 0:
                continue
            edge_pu = (pu_list[i] if sig[i] > 0 else 1.0 - pu_list[i])
            conv = (edge_pu - threshold) / denom
            size_factors[i] = min(1.0, max(_CONVICTION_FLOOR, conv))
    elif position_sizing == "pyramiding":
        step = 1.0 / max(1, pyramid_steps)  # full size reached after pyramid_steps bars
        streak = 0
        prev_sign = 0
        for i in range(n):
            # Ramp over consecutive SAME-direction bars; reset on flip or flat.
            streak = streak + 1 if (sig[i] != 0 and sig[i] == prev_sign) else (1 if sig[i] != 0 else 0)
            prev_sign = sig[i]
            size_factors[i] = min(1.0, step * streak)

    pos: list[float] = []
    for i in range(n):
        if sig[i] == 0:
            pos.append(0.0)
            continue
        if is_vol and vol_mode == "vol_targeting":
            sv = spread_rel[i]
            tv = target_vols[i]
            raw = min(1.0, tv / sv) if (sv and sv > 0 and tv) else 1.0
        elif is_vol and vol_mode == "vol_breakout":
            sv = spread_rel[i]
            window = [s for s in spread_rel[max(0, i - _VOL_WINDOW):i] if s is not None]
            avg = sum(window) / len(window) if window else None
            raw = 1.0 if (sv is not None and avg is not None and sv > avg) else 0.0
        else:
            raw = 1.0
        # sig carries the sign: +size for longs, -size for shorts.
        pos.append(sig[i] * raw * size_factors[i])

    # n_fills = real exchange orders: one per bar where the position size changes
    # (entry, each add/trim, exit), plus the final close-out. Scaling schemes
    # (conviction, pyramiding) generate many more fills than "trades" (campaigns).
    net: list[float] = []
    prev_pos = 0.0
    n_fills = 0
    for i in range(n):
        delta = pos[i] - prev_pos
        if abs(delta) > 1e-9:
            n_fills += 1
        cost = abs(delta) * fee_side
        # Floor at -100%: a short against a >100% up-bar is a bankruptcy, not
        # negative equity (which would flip the compounded curve's sign).
        net.append(max(pos[i] * bar_ret[i] - cost, -1.0))
        prev_pos = pos[i]
    if abs(pos[-1]) > 1e-9:  # close out the final open position (long or short)
        net[-1] -= abs(pos[-1]) * fee_side
        n_fills += 1

    strat_eq, e = [], 1.0
    for r in net:
        e *= 1 + r
        strat_eq.append(e)
    bh_eq, e2 = [], 1.0
    for r in bar_ret:
        e2 *= 1 + r
        bh_eq.append(e2)
    bh_final = bh_eq[-1] * (1 - 2 * fee_side)  # buy & hold pays one round trip

    # Per-trade returns (a trade = a contiguous run with non-zero exposure).
    # trade_markers carries each trade's entry timestamp + net return so the UI
    # can mark the equity curve (green = winning trade, red = losing).
    trades: list[float] = []
    trade_markers: list[dict] = []
    i = 0
    while i < n:
        if abs(pos[i]) > 1e-9:
            entry_ts = rows[i][0]
            side = 1 if pos[i] > 0 else -1
            run, j = 1.0, i
            # A campaign is a contiguous run holding the SAME direction; a
            # long→short flip ends one trade and starts another.
            while j < n and abs(pos[j]) > 1e-9 and (1 if pos[j] > 0 else -1) == side:
                run *= 1 + net[j]
                j += 1
            ret = run - 1.0
            trades.append(ret)
            trade_markers.append({
                "timestamp": entry_ts, "ret": ret,
                "side": "long" if side > 0 else "short",
            })
            i = j
        else:
            i += 1
    n_trades = len(trades)
    wins = sum(1 for t in trades if t > 0)

    mean = sum(net) / n
    var = sum((r - mean) ** 2 for r in net) / n
    std = math.sqrt(var)
    sharpe = (mean / std * math.sqrt(periods_per_year)) if std > 0 else 0.0

    peak, mdd = -1.0, 0.0
    for eq in strat_eq:
        peak = max(peak, eq)
        if peak > 0:
            mdd = min(mdd, (eq - peak) / peak)

    long_bars = sum(1 for p in pos if p > 0)
    short_bars = sum(1 for p in pos if p < 0)
    # Downsample the curve to keep the payload light.
    step = max(1, n // 1500)
    idxs = list(range(0, n, step))
    if idxs[-1] != n - 1:
        idxs.append(n - 1)
    curve = [{"timestamp": rows[k][0], "strategy": strat_eq[k], "buy_hold": bh_eq[k]} for k in idxs]

    return {
        "n_bars": n,
        "n_trades": n_trades,
        "n_fills": n_fills,
        "long_bars": long_bars,
        "short_bars": short_bars,
        "allow_short": allow_short,
        "exposure_pct": (long_bars + short_bars) / n * 100,
        "win_rate_pct": (wins / n_trades * 100) if n_trades else 0.0,
        "total_return_pct": (strat_eq[-1] - 1) * 100,
        "buy_hold_return_pct": (bh_final - 1) * 100,
        "avg_return_per_trade_pct": (sum(trades) / n_trades * 100) if n_trades else 0.0,
        "sharpe": sharpe,
        "max_drawdown_pct": mdd * 100,
        "vol_source": ("forecast" if used_pred_vol else "band") if is_vol else None,
        "effective_min_edge_pct": edge * 100,
        "equity_curve": curve,
        "trade_markers": trade_markers,
    }

_SORT_COLUMNS = {
    "name": KlineSimulation.name,
    "strategy": KlineSimulation.strategy,
    "coin": Coin.symbol,
    "quote_asset": KlineSimulation.quote_asset,
    "interval": KlineSimulation.interval,
    "start_date": KlineSimulation.start_date,
    "finished_at": KlineSimulation.finished_at,
    "status": KlineSimulation.status,
    "starred": KlineSimulation.starred,
    "score": KlineSimulation.score,
    "score_t": KlineSimulation.score_t,
    "score_vol": KlineSimulation.score_vol,
    "score_vol_t": KlineSimulation.score_vol_t,
    "created_at": KlineSimulation.created_at,
}

# Score-like sort fields: NULLs (unscored/failed/non-vol runs) go last either way.
_NULLS_LAST_FIELDS = {"score", "score_t", "score_vol", "score_vol_t"}


class KlineSimulationRecordService:
    """CRUD + listing for persisted simulation runs."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        coin_id: str,
        quote_asset: str,
        interval: str,
        start_date: date,
        end_date: date,
        models: list[str],
        name: str | None = None,
        description: str | None = None,
        strategy: str = "price",
        config: dict | None = None,
    ) -> KlineSimulation:
        rec = KlineSimulation(
            coin_id=coin_id,
            quote_asset=quote_asset,
            interval=interval,
            start_date=start_date,
            end_date=end_date,
            models=models,
            name=name,
            description=description,
            strategy=strategy,
            config=config,
            status="pending",
        )
        self.session.add(rec)
        await self.session.flush()
        await self.session.refresh(rec)
        return rec

    async def get(self, id: str) -> KlineSimulation | None:
        stmt = (
            select(KlineSimulation)
            .where(KlineSimulation.id == id)
            .options(selectinload(KlineSimulation.coin))
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list(
        self,
        search: str | None = None,
        sort_field: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[KlineSimulation], int]:
        base = (
            select(KlineSimulation)
            .join(Coin, Coin.id == KlineSimulation.coin_id)
            .where(KlineSimulation.active.is_(True))
        )
        if search:
            like = f"%{search}%"
            base = base.where(
                or_(
                    KlineSimulation.name.ilike(like),
                    Coin.symbol.ilike(like),
                    Coin.name.ilike(like),
                    KlineSimulation.quote_asset.ilike(like),
                    KlineSimulation.interval.ilike(like),
                    KlineSimulation.status.ilike(like),
                )
            )

        total = (
            await self.session.execute(select(func.count()).select_from(base.subquery()))
        ).scalar_one()

        col = _SORT_COLUMNS.get(sort_field, KlineSimulation.created_at)
        directed = col.asc() if sort_dir == "asc" else col.desc()
        # Keep unscored runs (pending/failed → NULL score) at the bottom either
        # way. `is_(None)` sorts False(0) before True(1), portable to SQLite.
        order = [col.is_(None), directed] if sort_field in _NULLS_LAST_FIELDS else [directed]
        stmt = (
            base.options(selectinload(KlineSimulation.coin))
            .order_by(*order)
            .offset(offset)
            .limit(limit)
        )
        items = (await self.session.execute(stmt)).scalars().all()
        return list(items), total

    async def set_task(self, id: str, task_id: str) -> None:
        rec = await self.get(id)
        if rec:
            rec.task_id = task_id
            await self.session.flush()

    async def mark(
        self,
        id: str,
        status: str,
        *,
        result: dict | None = None,
        error: str | None = None,
        finished: bool = False,
    ) -> KlineSimulation | None:
        rec = await self.get(id)
        if not rec:
            return None
        rec.status = status
        if result is not None:
            rec.result = result
            for attr in ("score", "score_t", "score_vol", "score_vol_t"):
                v = result.get(attr) if isinstance(result, dict) else None
                setattr(rec, attr, float(v) if isinstance(v, (int, float)) else None)
        if error is not None:
            rec.error = error
        if finished:
            rec.finished_at = datetime.now(UTC)
        await self.session.flush()
        return rec

    async def update(self, id: str, data: KlineSimulationUpdate) -> KlineSimulation | None:
        rec = await self.get(id)
        if not rec:
            return None
        if data.starred is not None:
            rec.starred = data.starred
        await self.session.flush()
        return rec

    async def delete(self, id: str) -> bool:
        rec = await self.get(id)
        if not rec:
            return False
        await self.session.delete(rec)
        await self.session.flush()
        return True

    # ── Predictions ─────────────────────────────────────────────────────────

    async def add_predictions(
        self, simulation_id: str, model_name: str, rows: list[dict]
    ) -> int:
        """Bulk-insert per-timestamp forecast rows for one model."""
        if not rows:
            return 0
        values = []
        for r in rows:
            ts = r["timestamp"]
            if isinstance(ts, str):
                ts = datetime.fromisoformat(ts)
            values.append(
                {
                    "simulation_id": simulation_id,
                    "model_name": model_name,
                    "timestamp": ts,
                    "actual": r["actual"],
                    "predicted": r["predicted"],
                    "error": r["error"],
                    "pct_error": r["pct_error"],
                    "prev_close": r.get("prev_close"),
                    "quantiles": r.get("quantiles"),
                    "prob_up": r.get("prob_up"),
                    "in_interval": r.get("in_interval"),
                    "pred_vol": r.get("pred_vol"),
                    "realized_vol": r.get("realized_vol"),
                }
            )
        await self.session.execute(insert(KlineSimulationPrediction), values)
        return len(values)

    async def prediction_coverage(
        self, simulation_id: str, model: str | None = None
    ) -> tuple[int, int]:
        """(rows where actual fell inside the 80% band, rows with a band)."""
        base = select(KlineSimulationPrediction).where(
            KlineSimulationPrediction.simulation_id == simulation_id,
            KlineSimulationPrediction.in_interval.isnot(None),
        )
        if model:
            base = base.where(KlineSimulationPrediction.model_name == model)
        graded = (await self.session.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
        inside = (
            await self.session.execute(
                select(func.count()).select_from(
                    base.where(KlineSimulationPrediction.in_interval.is_(True)).subquery()
                )
            )
        ).scalar_one()
        return inside, graded

    async def backtest(
        self,
        simulation_id: str,
        model: str | None = None,
        threshold: float = 0.6,
        fee_bps: float = 15.0,
        min_edge_pct: float = 0.0,
        vol_mode: str | None = None,
        cover_fees: bool = False,
        position_sizing: str = "none",
        pyramid_steps: int = 4,
        allow_short: bool = False,
    ) -> dict | None:
        """Run a fee-aware backtest (long, or long/short) over stored predictions."""
        sim = await self.get(simulation_id)
        if not sim:
            return None
        models = await self.prediction_model_names(simulation_id)
        if not models:
            return None
        use_model = model if (model and model in models) else models[0]

        stmt = (
            select(
                KlineSimulationPrediction.timestamp,
                KlineSimulationPrediction.prev_close,
                KlineSimulationPrediction.actual,
                KlineSimulationPrediction.predicted,
                KlineSimulationPrediction.prob_up,
                KlineSimulationPrediction.quantiles,
                KlineSimulationPrediction.pred_vol,
            )
            .where(
                KlineSimulationPrediction.simulation_id == simulation_id,
                KlineSimulationPrediction.model_name == use_model,
                KlineSimulationPrediction.prob_up.isnot(None),
                KlineSimulationPrediction.prev_close > 0,
            )
            .order_by(KlineSimulationPrediction.timestamp)
        )
        rows = (await self.session.execute(stmt)).all()
        if not rows:
            return None

        # The volatility-aware rule (sizing / breakout) is chosen live on the
        # Backtest tab; no vol_mode → the plain confidence-thresholded rule.
        vm = vol_mode if vol_mode in ("vol_targeting", "vol_breakout") else None
        strat = "price_volatility" if vm else "price"

        bar_minutes = _interval_minutes(sim.interval)
        periods_per_year = int(round(365 * 24 * 60 / bar_minutes))
        sizing = position_sizing if position_sizing in ("conviction", "pyramiding") else "none"
        steps = max(1, min(50, pyramid_steps))
        result = _compute_backtest(
            rows, threshold, fee_bps, min_edge_pct, periods_per_year,
            strategy=strat, vol_mode=vm, cover_fees=cover_fees, position_sizing=sizing,
            pyramid_steps=steps, allow_short=allow_short,
        )
        result.update({
            "model": use_model,
            "strategy": strat,
            "vol_mode": vm,
            "position_sizing": sizing,
            "pyramid_steps": steps,
            "threshold": threshold,
            "fee_bps": fee_bps,
            "min_edge_pct": min_edge_pct,
            "cover_fees": cover_fees,
            "periods_per_year": periods_per_year,
        })
        return result

    async def prediction_mape(self, simulation_id: str, model: str | None = None) -> float | None:
        """Mean absolute percentage error over the (optionally model-filtered) set."""
        stmt = select(func.avg(KlineSimulationPrediction.pct_error)).where(
            KlineSimulationPrediction.simulation_id == simulation_id
        )
        if model:
            stmt = stmt.where(KlineSimulationPrediction.model_name == model)
        avg = (await self.session.execute(stmt)).scalar_one_or_none()
        return float(avg) if avg is not None else None

    async def prediction_model_names(self, simulation_id: str) -> list[str]:
        stmt = (
            select(KlineSimulationPrediction.model_name)
            .where(KlineSimulationPrediction.simulation_id == simulation_id)
            .distinct()
            .order_by(KlineSimulationPrediction.model_name)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_predictions(
        self,
        simulation_id: str,
        model: str | None = None,
        sort_field: str = "timestamp",
        sort_dir: str = "asc",
        limit: int = 50,
        offset: int = 0,
        direction: str | None = None,
        forecast: str | None = None,
    ) -> tuple[list[KlineSimulationPrediction], int]:
        # The forecast value (point or a quantile) drives the direction columns.
        fexpr = _forecast_expr(forecast)
        model_dir = fexpr - KlineSimulationPrediction.prev_close

        base = select(KlineSimulationPrediction).where(
            KlineSimulationPrediction.simulation_id == simulation_id
        )
        if model:
            base = base.where(KlineSimulationPrediction.model_name == model)
        if direction == "correct":  # forecast called up and it rose
            base = base.where(model_dir > 0, _ACTUAL_DIR > 0)
        elif direction == "faulty":  # forecast called up but it fell
            base = base.where(model_dir > 0, _ACTUAL_DIR < 0)

        total = (
            await self.session.execute(select(func.count()).select_from(base.subquery()))
        ).scalar_one()

        if sort_field == "predicted":
            col = fexpr
        elif sort_field == "model_direction":
            col = model_dir
        elif sort_field == "direction":
            col = case((and_(model_dir > 0, _ACTUAL_DIR > 0), 2), (and_(model_dir > 0, _ACTUAL_DIR < 0), 1), else_=0)
        else:
            col = _PRED_SORT_COLUMNS.get(sort_field, KlineSimulationPrediction.timestamp)
        col = col.asc() if sort_dir == "asc" else col.desc()
        stmt = base.order_by(col).offset(offset).limit(limit)
        items = (await self.session.execute(stmt)).scalars().all()
        return list(items), total
