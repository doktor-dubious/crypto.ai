"""Live-trade execution engine: real Binance orders driven by strategy signals.

The live twin of ``paper_trade_engine``, sharing its signal computation but not
its fill model. Paper trading deterministically replays the backtest and
synthesizes fills; live trading cannot — orders are real, so past state is
whatever actually filled. The engine instead runs **target-position
reconciliation** each tick, per running run:

  1. load the same trailing kline window and replay the same backtest the paper
     engine uses (imported helpers — one signal implementation, two executors);
  2. read the replay's *desired* position at the newest bar (the "open trade at
     the window edge" artifact, exactly as paper detects it);
  3. compare with the run's *actual* position and place market orders on the
     configured Binance endpoint (Spot testnet by default) for the difference:
     flat→long buys with the run's quote cash, long→flat sells the actual held
     quantity. Spot cannot short, so short signals are skipped (long→short
     flips just exit to flat) and noted on the run.

Every fill is recorded with its Binance order id, executed quantity, average
fill price and commission — the trade log is what the exchange did, not what
the backtest imagined. A replayed signal is acted on at most once: each entry
records the replay's ``signal_time``, and any signal already recorded (executed
or vetoed) is never re-entered nor re-consulted.

The AI confirmation gate is shared with paper trading (``trade_advisor``): a
gated entry consults the advisor first; ``pending`` holds the bar cursor so the
next tick retries, and the same fail-closed counter vetoes after persistent
advisor failures.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.kline import Kline
from crypto_ai.database.models.live_trade import LiveTrade
from crypto_ai.database.models.live_trade_equity import LiveTradeEquity
from crypto_ai.database.models.live_trade_run import LiveTradeRun
from crypto_ai.database.models.strategy_template import StrategyTemplate
from crypto_ai.services.binance_trade_client import (
    BinanceTradeClient,
    BinanceTradeError,
    parse_fill,
)
from crypto_ai.services.kline_simulation_record import _interval_minutes
from crypto_ai.services.paper_trade_engine import (
    _KLINE_COLS,
    _MAX_AI_CONSULT_FAILURES,
    _btc_rows,
    _evaluate,
    _parse_knobs,
    _recent_bars,
    _run_config,
    _wants_btc_filter,
)
from crypto_ai.services.swing_analysis import _Z_WIN, htf_min_bars
from crypto_ai.services.trade_advisor import (
    TradeAdvisorError,
    build_trade_context,
    get_trade_verdict,
)

log = structlog.get_logger()
trade_ai_log = structlog.get_logger("crypto_ai.trade_ai")


class LiveTradeEngine:
    """Reconciles running live runs against their strategy's target position."""

    def __init__(self, session: AsyncSession, client: BinanceTradeClient | None = None) -> None:
        self.session = session
        # An explicitly injected client overrides everything (tests, and the
        # single-venue callers that predate per-run venues). Otherwise every
        # order is placed through a client built for THAT RUN's venue — see
        # _client_for. Getting this wrong would send a testnet run's orders to
        # production, so the run's own flag is the only thing that decides.
        self._injected = client
        self._by_venue: dict[bool, BinanceTradeClient] = {}

    def _client_for(self, run: LiveTradeRun) -> BinanceTradeClient:
        """The client for this run's venue, cached per venue per engine."""
        if self._injected is not None:
            return self._injected
        testnet = bool(run.is_testnet)
        client = self._by_venue.get(testnet)
        if client is None:
            client = BinanceTradeClient(testnet=testnet)
            self._by_venue[testnet] = client
        return client

    # ── Public entry points ──────────────────────────────────────────────────

    async def step_all(self) -> int:
        """Advance every running live run. Same claim/isolation contract as the
        paper engine: per-run FOR UPDATE SKIP LOCKED + per-run commit, so
        overlapping ticks never double-place an order for the same run."""
        ids = (
            await self.session.execute(
                select(LiveTradeRun.id).where(
                    LiveTradeRun.status == "running",
                    LiveTradeRun.active.is_(True),
                )
            )
        ).scalars().all()
        stepped = 0
        for run_id in ids:
            claimed = (
                await self.session.execute(
                    select(LiveTradeRun, StrategyTemplate)
                    .join(StrategyTemplate, StrategyTemplate.id == LiveTradeRun.template_id)
                    .where(
                        LiveTradeRun.id == run_id,
                        LiveTradeRun.status == "running",
                        LiveTradeRun.active.is_(True),
                    )
                    .with_for_update(of=LiveTradeRun, skip_locked=True)
                )
            ).first()
            if claimed is None:
                continue
            run, tpl = claimed
            try:
                await self.step_run(run, tpl)
                await self.session.commit()
            except Exception as exc:  # one bad run must not stall the others
                log.warning("live_trade.step_failed", run_id=run.id, error=str(exc))
                await self.session.rollback()
                run.error = str(exc)[:500]
                run.last_step_at = datetime.now(UTC)
                await self.session.commit()
            stepped += 1
        return stepped

    async def step_run(self, run: LiveTradeRun, template: StrategyTemplate) -> None:
        """One reconciliation tick: replay → target position → real orders."""
        run.last_step_at = datetime.now(UTC)
        cfg = _run_config(run, template)
        if cfg is None:
            run.error = "Template has no coin / pair / timeframe scope."
            return
        scope = cfg["scope"]
        knobs = _parse_knobs(cfg["params"], scope["interval"])
        snapshot = cfg["snapshot"]

        interval_min = _interval_minutes(scope["interval"])
        # The higher-timeframe gate reads a much longer trailing span than the
        # z-scored features do, so it — not _Z_WIN — sets the window when on.
        min_history = max(_Z_WIN, htf_min_bars(knobs["htf_bars"]))
        warmup_bars = min_history + int(knobs["hold_bars"]) + 40
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

        if len(rows) < min_history + 10:
            run.error = (
                "Waiting for higher-timeframe warmup…"
                if len(rows) >= _Z_WIN + 10
                else "Waiting for kline data…"
            )
            return

        newest_bar = rows[-1][0]
        if run.last_bar_time is not None and newest_bar <= run.last_bar_time:
            return  # no new bar; keep any standing note on run.error

        # The BTC-beta filter needs BTC's bars on the same interval. If they're
        # missing the filter can't decide, and a silently unfiltered run would
        # be placing REAL orders for a different strategy than the one
        # configured — so say so and sit the tick out rather than degrade
        # quietly. Same rule as the paper engine.
        btc_rows: list | None = None
        if _wants_btc_filter(snapshot["strategy"], knobs):
            btc_rows = await _btc_rows(self.session, scope, lower)
            if btc_rows is not None and len(btc_rows) < len(rows) // 2:
                run.error = "Waiting for BTC klines (BTC-beta filter)…"
                return

        trades, times, closes, n = await asyncio.to_thread(
            _evaluate, snapshot["strategy"], knobs, rows, run.started_at, btc_rows
        )
        last_close = float(closes[-1])

        if n == 0:
            # First bar hasn't closed yet — baseline equity so P/L reads 0.
            run.error = None
            run.equity = float(run.cash_quote)
            await self._write_equity(run.id, newest_bar, run.equity)
            run.last_bar_time = newest_bar
            return

        # The replay's desired position at the newest bar (paper's open-trade
        # detection: "closed at the window edge by hold_max before the hold
        # actually elapsed" means it is really still open).
        hold_bars = int(knobs["hold_bars"])
        open_trade = None
        if trades:
            last = trades[-1]
            if (
                last["exit_i"] == n - 1
                and last["exit_reason"] == "hold_max"
                and (last["exit_i"] - last["i"]) < hold_bars
            ):
                open_trade = last
        desired_side = open_trade["side"] if open_trade is not None else None

        notes: list[str] = []
        pending = False

        if run.open_side > 0 and desired_side != "long":
            # Strategy no longer wants the long → sell to flat. A long→short
            # flip also lands here (the short leg itself is not executable).
            exit_reason = _replay_exit_reason(trades, open_trade, n)
            await self._exit_position(run, scope, exit_reason)

        elif run.open_side == 0 and desired_side == "long":
            signal_time = times[open_trade["i"]]
            if await self._signal_already_handled(run.id, signal_time):
                pass  # acted on (or vetoed) in an earlier tick — never re-enter
            else:
                state, verdict, explanation = await self._ai_decide(
                    run, template, scope, knobs, snapshot, rows, open_trade, times, closes
                )
                if state == "pending":
                    pending = True
                elif state == "veto":
                    await self._record_veto(
                        run, scope, knobs, snapshot, signal_time,
                        float(closes[open_trade["i"]]), verdict, explanation,
                    )
                else:
                    entered = await self._enter_position(
                        run, scope, knobs, snapshot, signal_time,
                        verdict, explanation, notes,
                    )
                    if not entered:
                        pass  # reason already in notes (budget below minimum, …)

        if desired_side == "short" and run.open_side == 0:
            notes.append("Short signal skipped (spot is long-only).")

        # Mark to market and persist the equity snapshot for P/L differencing.
        position_value = (run.open_qty or 0.0) * last_close
        run.equity = float(run.cash_quote) + position_value
        await self._write_equity(run.id, newest_bar, run.equity)
        run.n_closed_trades = await self._count_closed(run.id)
        if pending:
            # Retry the gate next TICK (not next bar): leave the cursor put.
            run.error = "Awaiting AI trade confirmation…"
            return
        run.last_bar_time = newest_bar
        run.error = " ".join(notes) if notes else None

    async def stop_run(self, run: LiveTradeRun, *, liquidate: bool = True) -> None:
        """Stop a run, market-selling any open position first. If the sell
        fails the run still stops, but the un-liquidated position is called out
        on ``error`` so it is never silently orphaned on the exchange."""
        # Status flips FIRST so the liquidation's own commit (orders commit the
        # moment they execute) persists "stopped" atomically with the sell — a
        # beat tick can then never claim a still-"running" run whose position
        # was just liquidated and buy back in.
        run.status = "stopped"
        run.stopped_at = datetime.now(UTC)
        cfg_scope = (run.scope or {})
        if liquidate and run.open_side > 0 and (run.open_qty or 0) > 0:
            scope = {
                "coin_id": cfg_scope.get("coin_id"),
                "quote_asset": cfg_scope.get("quote_asset") or "USDT",
            }
            try:
                await self._exit_position(run, scope, "stopped")
                run.equity = float(run.cash_quote)
            except Exception as exc:
                run.error = f"Stopped, but position NOT liquidated: {exc}"[:500]
                log.warning("live_trade.stop_liquidation_failed", run_id=run.id, error=str(exc))
            # The liquidation closed a trade, and only step_run refreshes this
            # cache — without it a stopped run under-reports its trade count by
            # one for good, which is what the Strategies page then displays.
            run.n_closed_trades = await self._count_closed(run.id)

    # ── Order placement ──────────────────────────────────────────────────────

    async def _enter_position(
        self, run, scope: dict, knobs: dict, snapshot: dict,
        signal_time: datetime, verdict: str | None, explanation: str | None,
        notes: list[str],
    ) -> bool:
        """Market-buy with the run's quote cash; record the real fill. Returns
        False (with a note) when the budget can't clear the exchange minimum."""
        symbol = await self._trade_symbol(scope)
        client = self._client_for(run)
        filters = await client.symbol_filters(symbol)
        budget = Decimal(str(round(float(run.cash_quote), 8)))
        if filters.min_notional > 0 and budget < filters.min_notional:
            notes.append(
                f"Cash {budget} below {symbol} exchange minimum "
                f"({filters.min_notional}) — entry skipped."
            )
            return False
        seq = await self._next_seq(run.id)
        order = await client.market_order(
            symbol, "BUY", quote_qty=budget,
            client_order_id=f"lt-{run.id[:8]}-{seq}-e",
        )
        fill = parse_fill(order, filters.base_asset, filters.quote_asset)
        if fill["qty"] <= 0:
            raise BinanceTradeError(f"BUY {symbol} returned no fill: {order.get('status')}")
        fill_time = _transact_time(order)
        spent = fill["quote_qty"]

        run.cash_quote = float(Decimal(str(run.cash_quote)) - spent)
        run.open_side = 1
        # Commission on a buy is taken from the received base asset — what the
        # run actually holds (and can later sell) is net of it.
        run.open_qty = float(fill["qty"] - fill["commission_base"])
        run.open_entry_price = float(fill["price"])
        run.open_entry_time = fill_time
        run.open_entry_quote = float(spent)
        run.last_trade_at = fill_time

        self.session.add(LiveTrade(
            run_id=run.id,
            trade_seq=seq,
            status="open",
            side="long",
            qty=float(fill["qty"]),
            entry_time=fill_time,
            entry_price=float(fill["price"]),
            fee_bps=knobs["fee_bps"],
            signal_time=signal_time,
            entry_order_id=order.get("orderId"),
            entry_commission=float(fill["commission_base"] + fill["commission_quote"]),
            ai_verdict=verdict,
            ai_explanation=explanation,
            **_snapshot_cols(snapshot),
        ))
        # The BUY has already executed on the exchange. Commit the fill and the
        # cash/position debit NOW: if anything later in this tick fails, the
        # per-run rollback must not be able to erase an executed order — a
        # forgotten fill makes the next tick re-buy the same signal with the
        # never-debited cash, doubling the real position.
        await self.session.commit()
        trade_ai_log.info(
            "live_trade.entered", run_id=run.id, symbol=symbol,
            qty=run.open_qty, price=run.open_entry_price, order_id=order.get("orderId"),
        )
        return True

    async def _exit_position(self, run, scope: dict, exit_reason: str) -> None:
        """Market-sell the actual held quantity; close the open trade row."""
        symbol = await self._trade_symbol(scope)
        client = self._client_for(run)
        filters = await client.symbol_filters(symbol)
        held = Decimal(str(run.open_qty or 0))
        sell_qty = filters.round_qty(held)
        open_row = await self._open_trade_row(run.id)

        if sell_qty <= 0 or sell_qty < filters.min_qty:
            # Dust: unsellable at the exchange's lot size. Close the book at the
            # entry mark; the dust stays in the account but off this run.
            if open_row is not None:
                open_row.status = "closed"
                open_row.exit_time = datetime.now(UTC)
                open_row.exit_price = run.open_entry_price
                open_row.exit_reason = "dust"
                open_row.realized_pnl = -float(run.open_entry_quote or 0)
                open_row.ret = -1.0 if run.open_entry_quote else None
            _set_flat(run)
            return

        order = await client.market_order(
            symbol, "SELL", quantity=sell_qty,
            client_order_id=f"lt-{run.id[:8]}-{open_row.trade_seq if open_row else 0}-x",
        )
        fill = parse_fill(order, filters.base_asset, filters.quote_asset)
        fill_time = _transact_time(order)
        # Sell commission is taken from the received quote currency.
        proceeds = fill["quote_qty"] - fill["commission_quote"]

        run.cash_quote = float(Decimal(str(run.cash_quote)) + proceeds)
        entry_quote = float(run.open_entry_quote or 0)
        realized = float(proceeds) - entry_quote

        if open_row is not None:
            open_row.status = "closed"
            open_row.exit_time = fill_time
            open_row.exit_price = float(fill["price"])
            open_row.exit_order_id = order.get("orderId")
            open_row.exit_commission = float(fill["commission_quote"] + fill["commission_base"])
            open_row.realized_pnl = realized
            open_row.ret = realized / entry_quote if entry_quote > 0 else None
            open_row.exit_reason = exit_reason
        run.last_trade_at = fill_time
        _set_flat(run)
        # Same rule as the entry: the SELL already executed, so make the closed
        # trade and the cash credit durable before anything else can fail —
        # rolling this back would resurrect a position the exchange no longer
        # holds and the next tick would try to sell it again.
        await self.session.commit()
        trade_ai_log.info(
            "live_trade.exited", run_id=run.id, symbol=symbol,
            qty=float(sell_qty), price=float(fill["price"]),
            realized_pnl=realized, reason=exit_reason, order_id=order.get("orderId"),
        )

    # ── AI confirmation gate (shared advisor, single decision per tick) ───────

    async def _ai_decide(
        self, run, template, scope, knobs, snapshot, rows, open_trade, times, closes
    ) -> tuple[str, str | None, str | None]:
        """(state, verdict, explanation) with state execute | veto | pending —
        same semantics and fail-closed counter as the paper engine's gate."""
        if not (template is not None and bool(template.ai_confirmation)):
            return "execute", None, None
        context = build_trade_context(
            symbol=await self._coin_symbol(scope["coin_id"]),
            quote_asset=scope["quote_asset"],
            interval=scope["interval"],
            strategy=snapshot["strategy"],
            template_name=snapshot["template_name"],
            side="long",
            entry_time=times[open_trade["i"]],
            entry_price=float(closes[open_trade["i"]]),
            knobs=knobs,
            recent_bars=_recent_bars(rows, len(rows) - 1),
            run_stats={
                "closed_trades_so_far": run.n_closed_trades,
                "realized_pnl_quote": round(float(run.cash_quote) - float(run.initial_capital), 2),
                "initial_capital_quote": float(run.initial_capital),
            },
        )
        try:
            verdict, explanation = await get_trade_verdict(context)
        except TradeAdvisorError as exc:
            run.ai_consult_failures += 1
            if run.ai_consult_failures > _MAX_AI_CONSULT_FAILURES:
                trade_ai_log.warning(
                    "trade_ai.fail_closed", run_id=run.id,
                    failures=run.ai_consult_failures, live=True,
                )
                return "veto", "ERROR", (
                    f"AI advisor unreachable ({run.ai_consult_failures} consecutive "
                    f"failures) — live trade blocked fail-closed. Last error: {exc}"
                )[:2000]
            return "pending", None, None
        run.ai_consult_failures = 0
        return ("execute" if verdict == "GO" else "veto"), verdict, explanation

    async def _record_veto(
        self, run, scope, knobs, snapshot, signal_time, signal_price, verdict, explanation
    ) -> None:
        """A vetoed entry is recorded (qty 0, never executed) so the same signal
        is not re-consulted, and the Trade AI log keeps the paper-trail."""
        self.session.add(LiveTrade(
            run_id=run.id,
            trade_seq=await self._next_seq(run.id),
            status="closed",
            side="long",
            qty=0.0,
            entry_time=signal_time,
            entry_price=signal_price,
            fee_bps=knobs["fee_bps"],
            signal_time=signal_time,
            ai_verdict=verdict,
            ai_explanation=explanation,
            **_snapshot_cols(snapshot),
        ))
        await self.session.flush()

    # ── Lookups ──────────────────────────────────────────────────────────────

    async def _trade_symbol(self, scope: dict) -> str:
        base = await self._coin_symbol(scope["coin_id"])
        return f"{base.upper()}{(scope.get('quote_asset') or 'USDT').upper()}"

    async def _coin_symbol(self, coin_id: str) -> str:
        symbol = (
            await self.session.execute(select(Coin.symbol).where(Coin.id == coin_id))
        ).scalar_one_or_none()
        return symbol or coin_id

    async def _signal_already_handled(self, run_id: str, signal_time: datetime) -> bool:
        row = await self.session.execute(
            select(LiveTrade.id).where(
                LiveTrade.run_id == run_id,
                LiveTrade.signal_time == signal_time,
            ).limit(1)
        )
        return row.scalar_one_or_none() is not None

    async def _open_trade_row(self, run_id: str) -> LiveTrade | None:
        return (
            await self.session.execute(
                select(LiveTrade)
                .where(LiveTrade.run_id == run_id, LiveTrade.status == "open")
                .order_by(LiveTrade.trade_seq.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def _next_seq(self, run_id: str) -> int:
        current = (
            await self.session.execute(
                select(func.max(LiveTrade.trade_seq)).where(LiveTrade.run_id == run_id)
            )
        ).scalar_one_or_none()
        return 0 if current is None else current + 1

    async def _count_closed(self, run_id: str) -> int:
        return (
            await self.session.execute(
                select(func.count()).select_from(LiveTrade).where(
                    LiveTrade.run_id == run_id, LiveTrade.status == "closed"
                )
            )
        ).scalar_one()

    async def _write_equity(self, run_id: str, bar_time: datetime, equity: float) -> None:
        stmt = pg_insert(LiveTradeEquity)
        await self.session.execute(
            stmt.on_conflict_do_update(
                index_elements=["run_id", "bar_time"],
                set_={"equity": stmt.excluded.equity},
            ),
            [{"run_id": run_id, "bar_time": bar_time, "equity": float(equity)}],
        )


# ── Pure helpers ──────────────────────────────────────────────────────────────


def _replay_exit_reason(trades: list[dict], open_trade: dict | None, n: int) -> str:
    """Why the strategy wants out: the replay's newest CLOSED trade's reason if
    it closed at the newest bar, else a generic signal-driven exit. A long→short
    flip shows up as a desired short open trade instead — also 'signal'."""
    if open_trade is not None:
        return "signal"  # flip: the long closed because an opposite entry fired
    if trades and trades[-1]["exit_i"] == n - 1:
        return str(trades[-1]["exit_reason"])[:16]
    return "signal"


def _transact_time(order: dict) -> datetime:
    ms = order.get("transactTime") or order.get("workingTime")
    if ms:
        return datetime.fromtimestamp(int(ms) / 1000, UTC)
    return datetime.now(UTC)


def _snapshot_cols(snapshot: dict) -> dict:
    return {
        "template_id": snapshot["template_id"],
        "template_name": snapshot["template_name"],
        "strategy": snapshot["strategy"],
        "scope": snapshot["scope"],
        "params": snapshot["params"],
    }


def _set_flat(run: LiveTradeRun) -> None:
    run.open_side = 0
    run.open_qty = None
    run.open_entry_price = None
    run.open_entry_time = None
    run.open_entry_quote = None
