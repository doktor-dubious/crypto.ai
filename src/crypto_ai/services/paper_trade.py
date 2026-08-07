"""Service layer for paper-trade runs.

Manages the start→stop lifecycle of running strategy templates (one running run
per template) and reads back the state the execution engine
(``paper_trade_engine.py``) maintains: mark-to-market equity, open position,
trade count, and time-bucketed P/L differenced from the equity snapshots.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.config import get_settings
from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.kline import Kline
from crypto_ai.database.models.live_trade import LiveTrade
from crypto_ai.database.models.live_trade_run import LiveTradeRun
from crypto_ai.database.models.paper_trade import PaperTrade
from crypto_ai.database.models.paper_trade_equity import PaperTradeEquity
from crypto_ai.database.models.paper_trade_run import PaperTradeRun
from crypto_ai.database.models.strategy_template import StrategyTemplate
from crypto_ai.schemas.paper_trade import (
    AnalysisKline,
    BacktestTradeAnalysisRequest,
    PaperTradeAnalysisResponse,
    PaperTradePnl,
    PaperTradeResponse,
    PaperTradeRunResponse,
    TickLimitedCoin,
    TickLimitedCoins,
    TradeDateRange,
    TradeSignalInfo,
)
from crypto_ai.services.kline_simulation_record import _interval_minutes
from crypto_ai.services.paper_trade_engine import _parse_knobs, _parse_scope_dict
from crypto_ai.services.scalp_analysis import DEFAULTS as SCALP_DEFAULTS
from crypto_ai.services.tick_guard import coin_symbols, tick_limited_coins

# Trailing windows for the P/L buckets (response field name → duration).
_PNL_WINDOWS: dict[str, timedelta] = {
    "h1": timedelta(hours=1),
    "h3": timedelta(hours=3),
    "h6": timedelta(hours=6),
    "h12": timedelta(hours=12),
    "h24": timedelta(hours=24),
    "week": timedelta(days=7),
    "month": timedelta(days=30),
}


@dataclass(slots=True)
class _BacktestTrade:
    """The four attributes ``_entry_signal`` / ``_exit_signal`` read off a trade.

    A backtested round-trip has no PaperTrade row to pass them, and inventing a
    detached ORM instance would be worse than saying plainly what is needed.
    """

    entry_time: datetime
    exit_time: datetime | None
    side: str
    exit_reason: str | None


class PaperTradeService:
    """Start/stop/list paper-trade runs and surface their engine-computed P/L."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def start(
        self,
        template_id: str,
        initial_capital: float = 100.0,
        *,
        name: str | None = None,
        coin_id: str | None = None,
        quote_asset: str | None = None,
        interval: str | None = None,
        sweep_id: str | None = None,
    ) -> PaperTradeRun | None:
        """Start a NEW run for a template with the given paper investment (quote
        currency). Multiple concurrent runs of the same template are allowed, each
        with its own investment. ``coin_id`` / ``quote_asset`` / ``interval``
        override the template's saved scope, so one template can run on any market
        — that is how sweeps fan a param-set across the universe, and how an
        ABSTRACT strategy (which stores no scope at all) is given one at start.
        Returns None if the template is gone."""
        template = await self.session.get(StrategyTemplate, template_id)
        if template is None or not template.active:
            return None
        scope = dict(template.scope or {})
        if coin_id:
            scope["coin_id"] = coin_id
        if quote_asset:
            scope["quote_asset"] = quote_asset
        if interval:
            scope["interval"] = interval
        # A run needs a quote asset to price anything; abstract strategies and
        # sweep fan-outs may not have supplied one.
        if scope.get("coin_id"):
            scope.setdefault("quote_asset", "USDT")
        # No unique constraint stops two identical runs (multiple concurrent
        # runs per template are a feature), so a retried POST — proxy re-send,
        # double-click racing the disabled button, two tabs — must be absorbed
        # here: a duplicate run double-counts every pooled stat downstream.
        # An identical start within seconds is treated as the same request;
        # a deliberate duplicate later still goes through.
        clean_name = (name or "").strip() or None
        capital = max(0.0, float(initial_capital))
        window = datetime.now(UTC) - timedelta(seconds=10)
        recent = (
            await self.session.execute(
                select(PaperTradeRun).where(
                    PaperTradeRun.template_id == template_id,
                    PaperTradeRun.status == "running",
                    PaperTradeRun.active == True,  # noqa: E712
                    PaperTradeRun.started_at >= window,
                )
            )
        ).scalars().all()
        for existing in recent:
            if (
                (existing.scope or None) == (scope or None)
                and existing.sweep_id == sweep_id
                and float(existing.initial_capital) == capital
                and existing.name == clean_name
            ):
                return existing
        # Freeze the template config onto the run so a later edit/delete of the
        # template never rewrites this run's trade history.
        run = PaperTradeRun(
            template_id=template_id,
            sweep_id=sweep_id,
            status="running",
            initial_capital=capital,
            name=clean_name,
            template_name=template.name,
            strategy=template.strategy,
            scope=scope or None,
            params=template.params,
        )
        self.session.add(run)
        await self.session.flush()
        return run

    async def stop_run(self, run_id: str) -> PaperTradeRun | None:
        """Stop one specific running run by id (a template may have several)."""
        run = await self.session.get(PaperTradeRun, run_id)
        if run is None or not run.active or run.status != "running":
            return None
        run.status = "stopped"
        run.stopped_at = datetime.now(UTC)
        await self.session.flush()
        return run

    async def stop_template(self, template_id: str) -> PaperTradeRun | None:
        """Stop the template's current running run — the pre-``run_id`` stop
        contract, kept so clients built against it (old tabs, scripts) still
        stop something instead of getting a validation error. Tie-breaking
        matches ``_current_run`` so this stops the run the UI displays."""
        run = (
            await self.session.execute(
                select(PaperTradeRun)
                .where(
                    PaperTradeRun.template_id == template_id,
                    PaperTradeRun.status == "running",
                    PaperTradeRun.active == True,  # noqa: E712
                )
                .order_by(
                    PaperTradeRun.started_at.desc(),
                    PaperTradeRun.n_closed_trades.desc(),
                    PaperTradeRun.id.asc(),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if run is None:
            return None
        return await self.stop_run(run.id)

    async def tick_limited(self) -> TickLimitedCoins:
        """Tick-guard verdict for every coin the paper pages can show.

        Evaluates the coins referenced by paper-trade runs and by template
        scopes (a template that never ran still renders a detail pane), not the
        whole coin table — the guard query reads a week of 5m bars per coin, so
        the candidate set is kept to what the pages can actually display.
        """
        run_coins = (
            await self.session.execute(
                select(PaperTradeRun.scope["coin_id"].as_string().distinct()).where(
                    PaperTradeRun.active == True  # noqa: E712
                )
            )
        ).scalars().all()
        template_coins = (
            await self.session.execute(
                select(StrategyTemplate.scope["coin_id"].as_string().distinct()).where(
                    StrategyTemplate.active == True  # noqa: E712
                )
            )
        ).scalars().all()
        limited = await tick_limited_coins(
            self.session, {*run_coins, *template_coins}
        )
        symbols = await coin_symbols(self.session, limited)
        return TickLimitedCoins(
            coins=[
                TickLimitedCoin(id=c, symbol=symbols.get(c, "?"))
                for c in sorted(limited, key=lambda c: symbols.get(c, "?"))
            ],
            tick_pct_limit=get_settings().sweep_max_tick_pct,
        )

    async def list_runs(self, active_only: bool = False) -> list[PaperTradeRunResponse]:
        """Runs joined with template identity, newest first (with P/L)."""
        stmt = (
            select(PaperTradeRun, StrategyTemplate)
            .join(StrategyTemplate, StrategyTemplate.id == PaperTradeRun.template_id)
            .where(PaperTradeRun.active == True)  # noqa: E712
        )
        if active_only:
            stmt = stmt.where(PaperTradeRun.status == "running")
        stmt = stmt.order_by(PaperTradeRun.started_at.desc())
        rows = (await self.session.execute(stmt)).all()
        return [await self._to_response(run, tpl) for run, tpl in rows]

    async def running_template_ids(self) -> set[str]:
        """Template ids that currently have a running run (for the table toggle)."""
        result = await self.session.execute(
            select(PaperTradeRun.template_id).where(
                PaperTradeRun.status == "running",
                PaperTradeRun.active == True,  # noqa: E712
            )
        )
        return set(result.scalars().all())

    async def list_trades(
        self,
        template_id: str,
        limit: int = 500,
        *,
        run_id: str | None = None,
        all_runs: bool = False,
    ) -> list[PaperTradeResponse]:
        """Trades for ONE of the template's runs, newest first. ``run_id`` picks
        it explicitly (the pane's run selector); without it we fall back to the
        template's current run — see ``_current_run``.

        ``all_runs`` pools EVERY run of the template instead, for the detail
        pane's merged view across paper / testnet / live. Ordering then has to be
        by entry time rather than ``trade_seq``, which restarts per run.
        """
        if all_runs:
            run_ids = (
                await self.session.execute(
                    select(PaperTradeRun.id).where(
                        PaperTradeRun.template_id == template_id,
                        PaperTradeRun.active == True,  # noqa: E712
                    )
                )
            ).scalars().all()
            if not run_ids:
                return []
            rows = (
                await self.session.execute(
                    select(PaperTrade)
                    .where(PaperTrade.run_id.in_(run_ids))
                    .order_by(PaperTrade.entry_time.desc())
                    .limit(limit)
                )
            ).scalars().all()
            return [PaperTradeResponse.model_validate(tr) for tr in rows]

        run = await self._current_run(template_id, run_id=run_id)
        if run is None:
            return []
        rows = (
            await self.session.execute(
                select(PaperTrade)
                .where(PaperTrade.run_id == run.id)
                .order_by(PaperTrade.trade_seq.desc())
                .limit(limit)
            )
        ).scalars().all()
        return [PaperTradeResponse.model_validate(tr) for tr in rows]

    async def _current_run(
        self, template_id: str, *, run_id: str | None = None
    ) -> PaperTradeRun | None:
        """The template's current run: a RUNNING run wins over a more recently
        started but stopped one (a template can have both, e.g. a long-lived run
        plus an abandoned duplicate), else the latest.

        A sweep fans one template across N coins in a single beat, so those runs
        share both keys — the busiest run, then the lowest id, break the tie so
        the pick can't flip between requests. ``run_id`` short-circuits all of
        it, but only for a run that belongs to this template.
        """
        if run_id is not None:
            run = await self.session.get(PaperTradeRun, run_id)
            if run is None or not run.active or run.template_id != template_id:
                return None
            return run
        return (
            await self.session.execute(
                select(PaperTradeRun)
                .where(
                    PaperTradeRun.template_id == template_id,
                    PaperTradeRun.active == True,  # noqa: E712
                )
                .order_by(
                    (PaperTradeRun.status == "running").desc(),
                    PaperTradeRun.started_at.desc(),
                    PaperTradeRun.n_closed_trades.desc(),
                    PaperTradeRun.id.asc(),
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    # ── Trade analysis (kline snapshot around one trade) ─────────────────────

    async def trade_analysis(
        self, template_id: str, trade_seq: int, *, run_id: str | None = None
    ) -> PaperTradeAnalysisResponse | None:
        """Klines around a trade's entry and exit, with strategy-aware signal
        marks (which bars produced the entry / exit decision). Windows that
        overlap are merged into ``entry_klines``; otherwise ``gap_bars`` counts
        the bars hidden between the two windows.

        ``trade_seq`` is only unique within a run, so ``run_id`` must match the
        run the clicked row came from — the pane passes the selected one."""
        run = await self._current_run(template_id, run_id=run_id)
        if run is None:
            return None
        trade = (
            await self.session.execute(
                select(PaperTrade).where(
                    PaperTrade.run_id == run.id, PaperTrade.trade_seq == trade_seq
                )
            )
        ).scalar_one_or_none()
        if trade is None:
            return None
        scope = _parse_scope_dict(trade.scope or run.scope)
        if scope is None:
            return None
        strategy = trade.strategy or run.strategy or ""
        params = trade.params if trade.params is not None else (run.params or {})
        return await self._build_trade_analysis(
            scope, strategy, params, trade, PaperTradeResponse.model_validate(trade)
        )

    async def trade_date_range(self, template_id: str) -> TradeDateRange:
        """When this strategy has actually traded — across every venue.

        "Open in Analytics" uses this to scope the backtest to the period the
        strategy really ran, which is the only window where a backtest and a live
        record are comparable at all. Pools paper, testnet and live: they are
        different claims about the strategy, but they all bound the same span.
        """
        paper_runs = (
            await self.session.execute(
                select(PaperTradeRun.id).where(
                    PaperTradeRun.template_id == template_id,
                    PaperTradeRun.active == True,  # noqa: E712
                )
            )
        ).scalars().all()
        live_runs = (
            await self.session.execute(
                select(LiveTradeRun.id).where(
                    LiveTradeRun.template_id == template_id,
                    LiveTradeRun.active == True,  # noqa: E712
                )
            )
        ).scalars().all()

        first: datetime | None = None
        last: datetime | None = None
        total = 0
        for model, run_ids in ((PaperTrade, paper_runs), (LiveTrade, live_runs)):
            if not run_ids:
                continue
            row = (
                await self.session.execute(
                    select(
                        func.min(model.entry_time),
                        # An open trade has no exit yet — its entry still bounds
                        # the span, so fall back to it rather than dropping the row.
                        func.max(func.coalesce(model.exit_time, model.entry_time)),
                        func.count(),
                    ).where(model.run_id.in_(run_ids), model.active == True)  # noqa: E712
                )
            ).one()
            lo, hi, n = row
            total += int(n or 0)
            if lo is not None:
                first = lo if first is None else min(first, lo)
            if hi is not None:
                last = hi if last is None else max(last, hi)
        return TradeDateRange(first_entry=first, last_exit=last, n_trades=total)

    async def backtest_trade_analysis(
        self, req: BacktestTradeAnalysisRequest
    ) -> PaperTradeAnalysisResponse | None:
        """The same popup, for a trade that exists only inside a BACKTEST.

        A backtested round-trip has no run and no stored row — it is recomputed
        from the knobs every time the explorer re-analyses — so the caller sends
        the trade itself alongside the scope and parameters it came from. The
        chart, the signal marks and the explanations are then produced by exactly
        the same code that serves a paper trade, which is the point: the two
        popups must not be able to disagree about what a signal looks like.
        """
        scope = _parse_scope_dict({
            "coin_id": req.coin_id,
            "quote_asset": req.quote_asset,
            "interval": req.interval,
        })
        if scope is None:
            return None
        mark = _BacktestTrade(
            entry_time=req.entry_time,
            exit_time=req.exit_time,
            side=req.side,
            exit_reason=req.exit_reason,
        )
        resp = PaperTradeResponse(
            run_id="",
            source="backtest",
            trade_seq=req.seq,
            status="closed",
            side=req.side,
            qty=0.0,
            entry_time=req.entry_time,
            entry_price=req.entry_price,
            exit_time=req.exit_time,
            exit_price=req.exit_price,
            ret=req.ret_bps / 10_000.0,
            exit_reason=req.exit_reason,
            strategy=req.strategy,
            scope=scope,
            params=req.params,
        )
        return await self._build_trade_analysis(
            scope, req.strategy, req.params, mark, resp
        )

    async def _build_trade_analysis(
        self,
        scope: dict,
        strategy: str,
        params: dict,
        trade,
        trade_resp: PaperTradeResponse,
    ) -> PaperTradeAnalysisResponse | None:
        """The popup's payload for ONE round-trip.

        Split out from ``trade_analysis`` so a trade that exists only inside a
        BACKTEST — no run, no stored row — can render the identical chart. Only
        four attributes are read off ``trade`` (entry_time, exit_time, side,
        exit_reason), so the backtest path hands in a light stand-in.
        """
        knobs = _parse_knobs(params, scope["interval"])
        iv = timedelta(minutes=_interval_minutes(scope["interval"]))
        kind, span = _entry_mark_plan(strategy, knobs)

        # Entry window: enough lead bars to show the signal's inputs (channel /
        # streak / rolling window), a handful after. Lead is capped so a huge
        # window param can't turn the popup into a full history dump.
        lead = min(max(span + 6, int(knobs["threshold"]) + 8, 12), 72)
        tail = 6
        entry_lo = trade.entry_time - lead * iv
        entry_hi = trade.entry_time + tail * iv
        exit_lo = exit_hi = None
        if trade.exit_time is not None:
            exit_lo = trade.exit_time - 6 * iv
            exit_hi = trade.exit_time + tail * iv
            if exit_lo <= entry_hi + iv:  # adjacent/overlapping → one window
                entry_hi = exit_hi
                exit_lo = exit_hi = None

        entry_klines = await self._fetch_klines(scope, entry_lo, entry_hi)
        exit_klines: list[AnalysisKline] = []
        gap_bars = 0
        if exit_lo is not None:
            exit_klines = await self._fetch_klines(scope, exit_lo, exit_hi)
            if entry_klines and exit_klines:
                between = exit_klines[0].open_time - entry_klines[-1].open_time
                gap_bars = max(0, round(between / iv) - 1)

        all_bars = entry_klines + exit_klines
        symbol = (
            await self.session.execute(
                select(Coin.symbol).where(Coin.id == scope["coin_id"])
            )
        ).scalar_one_or_none() or scope["coin_id"]

        return PaperTradeAnalysisResponse(
            trade=trade_resp,
            symbol=symbol,
            quote_asset=scope["quote_asset"],
            interval=scope["interval"],
            entry_klines=entry_klines,
            exit_klines=exit_klines,
            gap_bars=gap_bars,
            entry_signal=_entry_signal(kind, span, knobs, entry_klines, trade),
            exit_signal=_exit_signal(knobs, all_bars, trade),
        )

    async def _fetch_klines(
        self, scope: dict, lo: datetime, hi: datetime
    ) -> list[AnalysisKline]:
        rows = (
            await self.session.execute(
                select(
                    Kline.open_time, Kline.open, Kline.high, Kline.low,
                    Kline.close, Kline.volume,
                )
                .where(and_(
                    Kline.coin_id == scope["coin_id"],
                    Kline.quote_asset == scope["quote_asset"],
                    Kline.interval == scope["interval"],
                    Kline.open_time >= lo,
                    Kline.open_time <= hi,
                    Kline.active.is_(True),
                ))
                .order_by(Kline.open_time)
            )
        ).all()
        return [
            AnalysisKline(
                open_time=t, open=float(o), high=float(h), low=float(low_),
                close=float(c), volume=float(v),
            )
            for t, o, h, low_, c, v in rows
        ]

    # ── P/L ───────────────────────────────────────────────────────────────────

    async def _compute_pnl(self, run: PaperTradeRun) -> PaperTradePnl:
        """total = equity − initial_capital; each bucket = equity − equity(now − w)."""
        if run.equity is None or run.last_bar_time is None:
            return PaperTradePnl()
        equity = float(run.equity)
        pnl = PaperTradePnl(total=round(equity - float(run.initial_capital), 4))
        for field, window in _PNL_WINDOWS.items():
            past = await self._equity_at_or_before(run.id, run.last_bar_time - window)
            if past is not None:
                setattr(pnl, field, round(equity - past, 4))
        return pnl

    async def _equity_at_or_before(
        self, run_id: str, cutoff: datetime
    ) -> float | None:
        result = await self.session.execute(
            select(PaperTradeEquity.equity)
            .where(
                PaperTradeEquity.run_id == run_id,
                PaperTradeEquity.bar_time <= cutoff,
            )
            .order_by(PaperTradeEquity.bar_time.desc())
            .limit(1)
        )
        val = result.scalar_one_or_none()
        return float(val) if val is not None else None

    async def _to_response(
        self, run: PaperTradeRun, tpl: StrategyTemplate
    ) -> PaperTradeRunResponse:
        end = run.stopped_at or datetime.now(UTC)
        started = run.started_at
        uptime_s = int((end - started).total_seconds()) if started else None
        position = (
            "long" if run.open_side > 0 else "short" if run.open_side < 0 else None
        )
        return PaperTradeRunResponse(
            id=run.id,
            template_id=run.template_id,
            name=run.name,
            status=run.status,
            started_at=run.started_at,
            stopped_at=run.stopped_at,
            uptime_s=uptime_s,
            last_trade_at=run.last_trade_at,
            initial_capital=float(run.initial_capital),
            template_name=run.template_name or tpl.name,
            strategy=run.strategy or tpl.strategy,
            scope=run.scope if run.scope is not None else tpl.scope,
            n_trades=run.n_closed_trades,
            position=position,
            error=run.error,
            pnl=await self._compute_pnl(run),
        )


# ── Trade-analysis signal marking (pure helpers) ──────────────────────────────
#
# These mirror the ENTRY definitions in scalp_analysis._signals / the swing
# composite closely enough to point at the bars a decision was built from —
# they don't re-run the signal math (the trade already happened; z-score warmup
# isn't available in a short window anyway).


def _entry_mark_plan(strategy: str, knobs: dict) -> tuple[str, int]:
    """(explanation kind, lookback bars the entry signal is built from)."""
    p = {**SCALP_DEFAULTS.get(strategy, {}), **knobs["param_values"]}
    if strategy == "streak":
        return "streak", 0  # actual run length is measured from the closes
    if strategy in ("range", "momentum", "sweep", "takerflow"):
        return strategy, max(2, int(p.get("window", 12)))
    if strategy == "indicator":
        return "indicator", 0
    return "swings", 0


def _find_bar(bars: list[AnalysisKline], t: datetime) -> int | None:
    for i, b in enumerate(bars):
        if b.open_time == t:
            return i
    return None


def _entry_signal(
    kind: str, span: int, knobs: dict, bars: list[AnalysisKline], trade: PaperTrade
) -> TradeSignalInfo | None:
    i = _find_bar(bars, trade.entry_time)
    if i is None:
        return None
    times = [b.open_time for b in bars]
    threshold = knobs["threshold"]
    data: dict = {"threshold": round(threshold, 2), "side": trade.side}

    if kind == "streak":
        # Walk the run of same-direction closes ending at the entry bar: a long
        # entry fades a down-run, a short entry fades an up-run.
        want_down = trade.side == "long"
        j = i
        while j >= 1 and (
            bars[j].close < bars[j - 1].close
            if want_down
            else bars[j].close > bars[j - 1].close
        ):
            j -= 1
        run_len = i - j
        p = {**SCALP_DEFAULTS["streak"], **knobs["param_values"]}
        data.update({
            "n": max(run_len, 1),
            "threshold": int(threshold),
            "voldiv": int(p.get("require_voldiv", 0)) >= 1,
        })
        marks = times[j + 1: i + 1] if run_len else [times[i]]
        return TradeSignalInfo(
            kind="streak", mark_times=marks, anchor_time=times[i], data=data
        )

    if kind in ("range", "momentum", "sweep"):
        # Channel strategies: the level comes from the PRIOR `span` bars
        # (shifted by one — the entry bar can't define its own channel).
        data["window"] = span
        return TradeSignalInfo(
            kind=kind,
            mark_times=times[max(0, i - span): i],
            anchor_time=times[i],
            data=data,
        )

    if kind == "takerflow":
        # Rolling imbalance mean INCLUDES the entry bar.
        data["window"] = span
        return TradeSignalInfo(
            kind="takerflow",
            mark_times=times[max(0, i - span + 1): i + 1],
            anchor_time=times[i],
            data=data,
        )

    if kind == "indicator":
        data["indicator"] = knobs["indicator"]
    return TradeSignalInfo(
        kind=kind, mark_times=[times[i]], anchor_time=times[i], data=data
    )


def _exit_signal(
    knobs: dict, bars: list[AnalysisKline], trade: PaperTrade
) -> TradeSignalInfo | None:
    if trade.exit_time is None:
        return None
    exit_i = _find_bar(bars, trade.exit_time)
    if exit_i is None:
        return None
    times = [b.open_time for b in bars]
    reason = trade.exit_reason or "hold_max"
    if reason == "hold_max":
        # The whole time-boxed hold determined this exit — mark every bar the
        # position lived through (both windows; a gap just hides the middle).
        marks = [
            t for t in times if trade.entry_time <= t <= trade.exit_time
        ]
        return TradeSignalInfo(
            kind="hold_max",
            mark_times=marks,
            anchor_time=times[exit_i],
            data={"hold_bars": int(knobs["hold_bars"])},
        )
    if reason == "stop":
        data = {"mode": knobs["sl_mode"], "value": knobs["sl_value"]}
    elif reason == "take_profit":
        data = {"mode": knobs["tp_mode"], "value": knobs["tp_value"]}
    else:  # reversal
        data = {"threshold": round(knobs["threshold"], 2)}
    return TradeSignalInfo(
        kind=reason, mark_times=[times[exit_i]], anchor_time=times[exit_i], data=data
    )
