"""Paper-trade execution engine: turns a running template into fills + P/L.

A running paper trade is just the strategy's own backtest, stepped forward. Each
tick, for every running run, the engine:

  1. loads a bounded trailing window of klines (warmup + everything since the run
     started) for the template's coin / pair / timeframe;
  2. replays the *same* trailing-only, non-overlapping trade engine the analytics
     pages use, but only counting trades from ``started_at`` onward;
  3. records every entry / exit as a paper fill (idempotent — the replay is
     deterministic, so re-running never duplicates a closed trade);
  4. marks the (possibly open) position to the latest close and writes an equity
     snapshot, from which the time-bucketed P/L is later differenced.

Because the backtest is trailing-only and non-overlapping, a trade that has
closed can never change when more bars arrive — so the closed-trade list is
append-only and ``(run_id, trade_seq, leg)`` is a stable idempotency key. The
newest trade may still be open; the engine detects the "closed at the window
edge by hold-max before the hold actually elapsed" artifact and treats that as
the live open position rather than a real exit.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import numpy as np
import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.kline import Kline
from crypto_ai.database.models.paper_trade import PaperTrade
from crypto_ai.database.models.paper_trade_equity import PaperTradeEquity
from crypto_ai.database.models.paper_trade_run import PaperTradeRun
from crypto_ai.database.models.strategy_template import StrategyTemplate
from crypto_ai.services.kline_simulation_record import _interval_minutes
from crypto_ai.services.scalp_analysis import DEFAULTS as SCALP_DEFAULTS
from crypto_ai.services.scalp_analysis import STRATEGIES as SCALP_STRATEGIES
from crypto_ai.services.scalp_analysis import ScalpAnalysisService
from crypto_ai.services.swing_analysis import (
    _Z_WIN,
    COMPONENT_KEYS,
    FLAG_KEYS,
    SwingAnalysisService,
)
from crypto_ai.services.trade_advisor import (
    TradeAdvisorError,
    build_trade_context,
    get_trade_verdict,
)

log = structlog.get_logger()

# Kline columns the feature computation expects, in order.
_KLINE_COLS = (
    Kline.open_time, Kline.open, Kline.high, Kline.low, Kline.close,
    Kline.volume, Kline.number_of_trades, Kline.taker_buy_base_asset_volume,
)

# With AI confirmation on, at most this many new trades are assessed per tick
# per run (a verdict can take ~a minute; the tick has a 270 s soft limit).
# Trades over budget stay pending and are assessed on later ticks.
_MAX_AI_CONSULTS_PER_TICK = 2
# Bars of trailing price action included in the advisor's trade card.
_AI_CONTEXT_BARS = 12


class PaperTradeEngine:
    """Steps running paper-trade runs forward as new bars close."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Public entry points ──────────────────────────────────────────────────

    async def step_all(self) -> int:
        """Advance every running run by any newly-closed bars. Returns the count
        of runs stepped. Each run is isolated: one failing never aborts the rest."""
        rows = (
            await self.session.execute(
                select(PaperTradeRun, StrategyTemplate)
                .join(StrategyTemplate, StrategyTemplate.id == PaperTradeRun.template_id)
                .where(
                    PaperTradeRun.status == "running",
                    PaperTradeRun.active.is_(True),
                )
            )
        ).all()
        for run, tpl in rows:
            try:
                await self.step_run(run, tpl)
                await self.session.commit()
            except Exception as exc:  # one bad run must not stall the others
                log.warning("paper_trade.step_failed", run_id=run.id, error=str(exc))
                # step_run may have left the transaction in a failed state; roll it
                # back before recording the error so this run's failure can't poison
                # the next run's commit.
                await self.session.rollback()
                run.error = str(exc)[:500]
                run.last_step_at = datetime.now(UTC)
                await self.session.commit()
        return len(rows)

    async def step_run(self, run: PaperTradeRun, template: StrategyTemplate) -> None:
        """Replay the strategy over [started_at, now] and persist trades + equity."""
        run.last_step_at = datetime.now(UTC)
        # Evaluate against the run's frozen snapshot (falls back to the live
        # template for runs created before snapshotting) so a mid-run template
        # edit never rewrites this run's trade history.
        cfg = _run_config(run, template)
        if cfg is None:
            run.error = "Template has no coin / pair / timeframe scope."
            return
        scope = cfg["scope"]
        knobs = _parse_knobs(cfg["params"])
        snapshot = cfg["snapshot"]  # {template_id, template_name, strategy, scope, params}

        interval_min = _interval_minutes(scope["interval"])
        warmup_bars = _Z_WIN + int(knobs["hold_bars"]) + 40
        lower = run.started_at - timedelta(minutes=interval_min * warmup_bars)
        rows = (
            await self.session.execute(
                select(*_KLINE_COLS)
                .where(and_(
                    Kline.coin_id == scope["coin_id"],
                    Kline.quote_asset == scope["quote_asset"],
                    Kline.interval == scope["interval"],
                    Kline.open_time >= lower,
                    Kline.active.is_(True),
                ))
                .order_by(Kline.open_time)
            )
        ).all()

        if len(rows) < _Z_WIN + 10:
            # Not enough history warmed up yet (fresh coin or ingester catching up).
            run.error = "Waiting for kline data…"
            return

        newest_bar = rows[-1][0]
        if run.last_bar_time is not None and newest_bar <= run.last_bar_time:
            run.error = None  # healthy, just no new bar since last tick
            return

        trades, times, closes, n = await asyncio.to_thread(
            _evaluate, snapshot["strategy"], knobs, rows, run.started_at
        )

        # No bar has yet fallen inside [started_at, now]: the run just started and
        # its first bar hasn't closed. Baseline the equity so P/L reads 0, not "—".
        if n == 0:
            run.error = None
            await self._write_equity(run.id, [(newest_bar, float(run.initial_capital))])
            _set_flat(run, float(run.initial_capital))
            run.last_bar_time = newest_bar
            return

        fee_rt = knobs["fee_bps"] / 1e4
        hold_bars = int(knobs["hold_bars"])

        # Split the immutable closed trades from a possibly-open last trade.
        open_trade = None
        closed = trades
        if trades:
            last = trades[-1]
            if (
                last["exit_i"] == n - 1
                and last["exit_reason"] == "hold_max"
                and (last["exit_i"] - last["i"]) < hold_bars
            ):
                open_trade, closed = last, trades[:-1]

        # AI confirmation gate: read LIVE from the template (not the run snapshot)
        # so the switch can be flipped while a run is going. Verdicts already
        # frozen onto trade rows always apply, gate on or off.
        ai_gate = bool(template.ai_confirmation) if template is not None else False
        verdicts = await self._load_verdicts(run.id)  # seq → verdict (None = ungated)
        consults_left = _MAX_AI_CONSULTS_PER_TICK
        pending = 0

        async def decide(seq: int, tr: dict) -> tuple[str, str | None, str | None]:
            """Execution decision for one replayed trade.

            Returns ``(state, verdict, explanation)`` with state:
              * "execute" — trade counts toward equity;
              * "veto"    — recorded with qty 0, excluded from equity;
              * "pending" — gated, no verdict yet: not recorded, retried next tick.
            A row that already exists keeps its frozen verdict forever (a NULL
            verdict means it was written ungated and stays executed).
            """
            nonlocal consults_left
            if seq in verdicts:
                v = verdicts[seq]
                return ("veto" if v == "NO_GO" else "execute"), v, None
            if not ai_gate:
                return "execute", None, None
            if consults_left <= 0:
                return "pending", None, None
            consults_left -= 1
            context = build_trade_context(
                symbol=await self._coin_symbol(scope["coin_id"]),
                quote_asset=scope["quote_asset"],
                interval=scope["interval"],
                strategy=snapshot["strategy"],
                template_name=snapshot["template_name"],
                side=tr["side"],
                entry_time=times[tr["i"]],
                entry_price=float(closes[tr["i"]]),
                knobs=knobs,
                recent_bars=_recent_bars(rows, tr["i"]),
                run_stats={
                    "closed_trades_so_far": executed_closed,
                    "realized_pnl_quote": round(eq - float(run.initial_capital), 2),
                    "initial_capital_quote": float(run.initial_capital),
                },
            )
            try:
                verdict, explanation = await get_trade_verdict(context)
            except TradeAdvisorError:
                return "pending", None, None  # fail-closed: retry next tick
            return ("execute" if verdict == "GO" else "veto"), verdict, explanation

        # Replay closed trades → trade rows, compounding realized equity over the
        # EXECUTED ones, and an equity snapshot at each executed exit (between
        # trades equity is flat, so a bucket boundary landing there reads the
        # prior exit's snapshot, which is correct). Vetoed trades are recorded
        # with qty 0 and their hypothetical return, but never step equity.
        trade_rows: list[dict] = []
        equity_points: list[tuple] = [(run.started_at, float(run.initial_capital))]
        eq = float(run.initial_capital)
        executed_closed = 0
        recorded_closed = 0
        last_trade_time = None  # most recent EXECUTED trade activity (for ordering)
        for seq, tr in enumerate(closed):
            state, verdict, explanation = await decide(seq, tr)
            if state == "pending":
                pending += 1
                continue
            direction = 1 if tr["side"] == "long" else -1
            entry_px = float(closes[tr["i"]])
            exit_px = entry_px * (1.0 + direction * (tr["ret"] + fee_rt))
            executed = state == "execute"
            qty = eq / entry_px if executed and entry_px > 0 else 0.0
            realized = eq * tr["ret"] if executed else 0.0
            trade_rows.append(_trade_row(
                run.id, seq, "closed", tr["side"], qty,
                times[tr["i"]], entry_px, times[tr["exit_i"]], exit_px,
                knobs["fee_bps"], float(tr["ret"]), realized, tr["exit_reason"], snapshot,
                ai_verdict=verdict, ai_explanation=explanation,
            ))
            recorded_closed += 1
            if executed:
                executed_closed += 1
                eq += realized
                equity_points.append((times[tr["exit_i"]], eq))
                last_trade_time = times[tr["exit_i"]]
        realized_equity = eq

        # Mark the open position (if any) to the latest close. A vetoed open
        # trade is recorded for the log but the run stays flat; a pending one
        # is neither recorded nor marked (retried next tick).
        open_state = None
        if open_trade is not None:
            seq = len(closed)
            open_state, verdict, explanation = await decide(seq, open_trade)
            if open_state == "pending":
                pending += 1
            else:
                direction = 1 if open_trade["side"] == "long" else -1
                entry_px = float(closes[open_trade["i"]])
                executed = open_state == "execute"
                qty = realized_equity / entry_px if executed and entry_px > 0 else 0.0
                trade_rows.append(_trade_row(
                    run.id, seq, "open", open_trade["side"], qty,
                    times[open_trade["i"]], entry_px, None, None,
                    knobs["fee_bps"], None, None, None, snapshot,
                    ai_verdict=verdict, ai_explanation=explanation,
                ))
        if open_trade is not None and open_state == "execute":
            direction = 1 if open_trade["side"] == "long" else -1
            entry_px = float(closes[open_trade["i"]])
            last_close = float(closes[-1])
            # Nothing has been deducted from realized_equity for this still-open
            # trade, so reserve the FULL round-trip fee (entry + exit) against the
            # mark — the same fee the closed-trade returns already bake in.
            open_mark = (
                direction * (last_close / entry_px - 1.0) - fee_rt
                if entry_px > 0 else 0.0
            )
            mark_equity = realized_equity * (1.0 + open_mark)
            run.open_side = direction
            run.open_entry_price = entry_px
            run.open_entry_time = times[open_trade["i"]]
            last_trade_time = times[open_trade["i"]]  # the live position is newest
        else:
            mark_equity = realized_equity
            run.open_side = 0
            run.open_entry_price = None
            run.open_entry_time = None

        run.last_trade_at = last_trade_time
        await self._write_trades(trade_rows)
        equity_points.append((newest_bar, mark_equity))
        await self._write_equity(run.id, equity_points)

        run.realized_equity = realized_equity
        run.equity = mark_equity
        run.n_closed_trades = recorded_closed
        # A pending verdict must be retried on the NEXT TICK, not the next bar —
        # leaving the bar cursor un-advanced defeats the "no new bar" early-out.
        if not pending:
            run.last_bar_time = newest_bar
        run.error = "Awaiting AI trade confirmation…" if pending else None

    # ── Persistence helpers ──────────────────────────────────────────────────

    async def _load_verdicts(self, run_id: str) -> dict[int, str | None]:
        """Existing trade rows' frozen AI verdicts, keyed by trade_seq. A key
        being present at all means the trade was already recorded (its verdict,
        NULL included, is final); an absent key means the trade is new."""
        rows = await self.session.execute(
            select(PaperTrade.trade_seq, PaperTrade.ai_verdict).where(
                PaperTrade.run_id == run_id
            )
        )
        return dict(rows.all())

    async def _coin_symbol(self, coin_id: str) -> str:
        symbol = (
            await self.session.execute(select(Coin.symbol).where(Coin.id == coin_id))
        ).scalar_one_or_none()
        return symbol or coin_id

    async def _write_equity(self, run_id: str, points: list[tuple]) -> None:
        """Upsert a batch of (bar_time, equity) snapshots for a run."""
        if not points:
            return
        # Deduplicate on bar_time (keep the last write for a given bar) so a single
        # statement never carries two rows with the same conflict key.
        by_bar = {bar_time: equity for bar_time, equity in points}
        rows = [
            {"run_id": run_id, "bar_time": bar_time, "equity": float(equity)}
            for bar_time, equity in by_bar.items()
        ]
        stmt = pg_insert(PaperTradeEquity)
        await self.session.execute(
            stmt.on_conflict_do_update(
                index_elements=["run_id", "bar_time"],
                set_={"equity": stmt.excluded.equity},
            ),
            rows,
        )

    async def _write_trades(self, rows: list[dict]) -> None:
        """Upsert trade rows, refreshing outcome fields as open trades close while
        preserving each row's frozen AI verdict (never overwritten by the replay)."""
        if not rows:
            return
        stmt = pg_insert(PaperTrade)
        # Everything except the conflict key and the AI verdict is refreshed from
        # the replay; ai_verdict / ai_explanation are written once and left alone.
        updatable = [
            "status", "side", "qty", "entry_time", "entry_price", "exit_time",
            "exit_price", "fee_bps", "ret", "realized_pnl", "exit_reason",
            "template_id", "template_name", "strategy", "scope", "params",
        ]
        set_ = {c: getattr(stmt.excluded, c) for c in updatable}
        set_["updated_at"] = func.now()
        await self.session.execute(
            stmt.on_conflict_do_update(
                index_elements=["run_id", "trade_seq"], set_=set_
            ),
            rows,
        )


# ── Pure helpers (module-level; the heavy one runs in a worker thread) ────────


def _run_config(run: PaperTradeRun, template: StrategyTemplate | None) -> dict | None:
    """Resolve the run's execution config, preferring its frozen snapshot.

    Returns ``{scope, params, snapshot}`` where ``scope`` is the parsed
    coin/pair/interval, ``params`` is the raw knob blob, and ``snapshot`` is the
    template identity/params stamped onto each trade. Falls back to the live
    template for runs created before snapshotting. None if scope is unusable.
    """
    strategy = run.strategy or (template.strategy if template else None)
    params_blob = run.params if run.params is not None else (
        (template.params or {}) if template else {}
    )
    scope_raw = run.scope if run.scope is not None else (
        template.scope if template else None
    )
    scope = _parse_scope_dict(scope_raw)
    if scope is None or not strategy:
        return None
    return {
        "scope": scope,
        "params": params_blob or {},
        "snapshot": {
            "template_id": run.template_id,
            "template_name": run.template_name or (template.name if template else None),
            "strategy": strategy,
            "scope": scope_raw,
            "params": params_blob or {},
        },
    }


def _parse_scope_dict(scope: dict | None) -> dict | None:
    scope = scope or {}
    coin_id = scope.get("coin_id")
    interval = scope.get("interval")
    if not coin_id or not interval:
        return None
    return {
        "coin_id": coin_id,
        "quote_asset": scope.get("quote_asset") or "USDT",
        "interval": interval,
    }


def _parse_knobs(params: dict) -> dict:
    """Read the explorer's (camelCase) knobs, tolerating snake_case fallbacks."""
    def g(*keys, default):
        for k in keys:
            if k in params:
                return params[k]
        return default

    return {
        "threshold": float(g("threshold", default=1.0)),
        "hold_bars": int(g("holdBars", "hold_bars", default=6)),
        "fee_bps": float(g("feeBps", "fee_bps", default=8.0)),
        "side": g("side", default="long"),
        "sl_mode": g("slMode", "sl_mode", default="none"),
        "sl_value": float(g("slValue", "sl_value", default=2.0)),
        "tp_mode": g("tpMode", "tp_mode", default="none"),
        "tp_value": float(g("tpValue", "tp_value", default=3.0)),
        "vol_gate": g("volGate", "vol_gate", default="off"),
        "vol_level": float(g("volLevel", "vol_level", default=1.0)),
        "indicator": g("indicator", default="ema"),
        "param_values": g("paramValues", "param_values", default={}) or {},
        "disabled_signals": g("disabledSignals", "disabled_signals", default=[]) or [],
        "weight_pct": g("weightPct", "weight_pct", default={}) or {},
    }


def _evaluate(
    strategy: str, knobs: dict, rows: list, start_dt: datetime
) -> tuple[list[dict], np.ndarray, np.ndarray, int]:
    """Compute the trade list for [start_dt, end] using the shared backtest.

    Returns ``(trades, times, closes, n_in_range)`` where ``n_in_range`` is the
    number of bars at/after ``start_dt`` (0 = run started but no bar closed yet).
    Runs synchronously — call via ``asyncio.to_thread``.
    """
    ctx = SwingAnalysisService._compute_context(rows, start_dt)
    n, first = ctx["n"], ctx["first"]
    if first >= n - 1:
        return [], ctx["times"], ctx["c"], 0

    if strategy == "swings":
        enabled = (set(COMPONENT_KEYS) | set(FLAG_KEYS)) - set(knobs["disabled_signals"])
        if not (enabled & set(COMPONENT_KEYS)):
            enabled = set(COMPONENT_KEYS) | set(FLAG_KEYS)
        weights = {k: float(v) / 100.0 for k, v in knobs["weight_pct"].items()}
        bottom, top = SwingAnalysisService._composite_scores(ctx, enabled, weights)
        trade_ctx = ctx
    elif strategy in SCALP_STRATEGIES:
        p = {**SCALP_DEFAULTS[strategy], **{k: float(v) for k, v in knobs["param_values"].items()}}
        long_s, short_s = ScalpAnalysisService._signals(ctx, strategy, knobs["indicator"], p)
        if knobs["vol_gate"] != "off":
            long_s, short_s = ScalpAnalysisService._apply_vol_gate(
                ctx, long_s, short_s, knobs["vol_gate"], knobs["vol_level"]
            )
        # Scalping never applies the swing breakout veto (momentum wants breakouts).
        trade_ctx = {**ctx, "veto_top": np.zeros(n, dtype=bool)}
        bottom, top = long_s, short_s
    else:
        raise ValueError(f"Unknown strategy: {strategy}")

    sim = SwingAnalysisService._run_trades(
        trade_ctx, bottom, top,
        threshold=knobs["threshold"], hold_bars=int(knobs["hold_bars"]),
        fee_bps=knobs["fee_bps"], side=knobs["side"],
        sl_mode=knobs["sl_mode"], sl_value=knobs["sl_value"],
        tp_mode=knobs["tp_mode"], tp_value=knobs["tp_value"],
        prob_by_time={},
    )
    return sim["trades"], ctx["times"], ctx["c"], n


def _trade_row(
    run_id: str, seq: int, status: str, side: str, qty: float,
    entry_time, entry_price: float, exit_time, exit_price: float | None,
    fee_bps: float, ret: float | None, realized_pnl: float | None,
    exit_reason: str | None, snapshot: dict,
    *, ai_verdict: str | None = None, ai_explanation: str | None = None,
) -> dict:
    # ai_verdict / ai_explanation only take effect on INSERT (a new trade's
    # first write); the replay's conflict-update path never touches them.
    return {
        "run_id": run_id, "trade_seq": seq, "status": status, "side": side,
        "qty": float(qty), "entry_time": entry_time, "entry_price": float(entry_price),
        "exit_time": exit_time,
        "exit_price": None if exit_price is None else float(exit_price),
        "fee_bps": float(fee_bps),
        "ret": None if ret is None else float(ret),
        "realized_pnl": None if realized_pnl is None else float(realized_pnl),
        "exit_reason": exit_reason,
        "template_id": snapshot["template_id"],
        "template_name": snapshot["template_name"],
        "strategy": snapshot["strategy"],
        "scope": snapshot["scope"],
        "params": snapshot["params"],
        "ai_verdict": ai_verdict,
        "ai_explanation": ai_explanation,
    }


def _recent_bars(rows: list, entry_i: int) -> list[dict]:
    """Compact OHLCV of the last bars up to (and including) the entry bar —
    the only price data the advisor sees, so no look-ahead past the entry."""
    window = rows[max(0, entry_i - _AI_CONTEXT_BARS + 1): entry_i + 1]
    return [
        {
            "time": t.isoformat(),
            "open": float(o), "high": float(h), "low": float(low),
            "close": float(c), "volume": float(v),
        }
        for t, o, h, low, c, v, _ntr, _taker in window
    ]


def _set_flat(run: PaperTradeRun, equity: float) -> None:
    run.equity = equity
    run.realized_equity = equity
    run.open_side = 0
    run.open_entry_price = None
    run.open_entry_time = None
    run.n_closed_trades = 0
