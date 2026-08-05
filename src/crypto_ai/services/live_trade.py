"""Service layer for live-trade runs (Trading → Live page).

Mirror of ``PaperTradeService`` for the live twin: start/stop lifecycle, run
listing with time-bucketed P/L differenced from equity snapshots, and the trade
log. Stopping a run liquidates its open position through the execution engine
(a real market sell), which is the one behavioural difference from paper.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.live_trade import LiveTrade
from crypto_ai.database.models.live_trade_equity import LiveTradeEquity
from crypto_ai.database.models.live_trade_run import LiveTradeRun
from crypto_ai.database.models.strategy_template import StrategyTemplate
from crypto_ai.schemas.live_trade import (
    LiveTradeAccountResponse,
    LiveTradePnl,
    LiveTradeResponse,
    LiveTradeRunResponse,
)
from crypto_ai.services.binance_trade_client import BinanceTradeClient, BinanceTradeError
from crypto_ai.services.live_trade_engine import LiveTradeEngine

_PNL_WINDOWS: dict[str, timedelta] = {
    "h1": timedelta(hours=1),
    "h3": timedelta(hours=3),
    "h6": timedelta(hours=6),
    "h12": timedelta(hours=12),
    "h24": timedelta(hours=24),
    "week": timedelta(days=7),
    "month": timedelta(days=30),
}


class LiveTradeNotConfiguredError(Exception):
    """Trading keys are missing — starting a live run is impossible."""


class LiveTradeService:
    """Start/stop/list live-trade runs and surface their exchange state."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.client = BinanceTradeClient()

    async def start(
        self,
        template_id: str,
        initial_capital: float = 100.0,
        *,
        testnet: bool | None = None,
        scope: dict | None = None,
        name: str | None = None,
    ) -> LiveTradeRun | None:
        """Start a NEW live run funding it with ``initial_capital`` of the
        account's quote currency. Verifies the exchange is reachable and the
        keys are valid BEFORE creating the run — a live run that can never
        place an order should fail at start, not at first signal.

        ``testnet`` picks the venue and is frozen onto the run, so the engine
        keeps stepping it there for life. ``None`` keeps the pre-per-run
        behaviour of using whatever the configured base points at. ``scope``
        overrides the strategy's saved market, which an ABSTRACT strategy
        (storing none) requires.
        """
        template = await self.session.get(StrategyTemplate, template_id)
        if template is None or not template.active:
            return None
        client = BinanceTradeClient(testnet=testnet) if testnet is not None else self.client
        if not client.is_configured:
            raise LiveTradeNotConfiguredError()
        # Surface bad keys / unreachable exchange as a start failure.
        await client.account()
        # Merge overrides key-by-key (as paper does): the route sends a partial
        # dict of just the params the caller set, and replacing the template's
        # whole scope with it would drop the saved interval/quote and strand
        # the run in "Template has no coin / pair / timeframe scope."
        run_scope = dict(template.scope or {})
        for key, value in (scope or {}).items():
            if value:
                run_scope[key] = value
        if run_scope.get("coin_id"):
            run_scope.setdefault("quote_asset", "USDT")
        run = LiveTradeRun(
            template_id=template_id,
            status="running",
            initial_capital=max(0.0, float(initial_capital)),
            cash_quote=max(0.0, float(initial_capital)),
            is_testnet=client.is_testnet,
            name=(name or "").strip() or None,
            template_name=template.name,
            strategy=template.strategy,
            scope=run_scope or None,
            params=template.params,
        )
        self.session.add(run)
        await self.session.flush()
        return run

    async def stop_run(self, run_id: str) -> LiveTradeRun | None:
        """Stop one running run, liquidating its open position (market sell).

        The engine is built WITHOUT an injected client so the liquidation goes
        to the run's own venue — selling a testnet position against production
        (or the reverse) is the one mistake here that spends real money.
        """
        # Take the same row lock the engine's tick holds (FOR UPDATE, no
        # skip_locked — we WAIT). A plain get could read the pre-buy snapshot
        # while a tick is mid-entry, stop on open_side=0, and leave the just
        # bought coins orphaned on the exchange under a "stopped" run.
        run = (
            await self.session.execute(
                select(LiveTradeRun)
                .where(LiveTradeRun.id == run_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if run is None or not run.active or run.status != "running":
            return None
        await LiveTradeEngine(self.session).stop_run(run)
        await self.session.flush()
        return run

    async def list_runs(self, active_only: bool = False) -> list[LiveTradeRunResponse]:
        stmt = (
            select(LiveTradeRun, StrategyTemplate)
            .join(StrategyTemplate, StrategyTemplate.id == LiveTradeRun.template_id)
            .where(LiveTradeRun.active == True)  # noqa: E712
        )
        if active_only:
            stmt = stmt.where(LiveTradeRun.status == "running")
        stmt = stmt.order_by(LiveTradeRun.started_at.desc())
        rows = (await self.session.execute(stmt)).all()
        return [await self._to_response(run, tpl) for run, tpl in rows]

    async def running_template_ids(self) -> set[str]:
        result = await self.session.execute(
            select(LiveTradeRun.template_id).where(
                LiveTradeRun.status == "running",
                LiveTradeRun.active == True,  # noqa: E712
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
    ) -> list[LiveTradeResponse]:
        """Trades for ONE of the template's live runs, newest first. ``run_id``
        picks it explicitly (the pane's run selector); without it we fall back to
        the template's current run — see ``_current_run``.

        ``all_runs`` pools EVERY live run of the template instead, for the detail
        pane's merged view across paper / testnet / live. Ordering then has to be
        by entry time rather than ``trade_seq``, which restarts per run.

        A trade carries no venue of its own — testnet vs production is a property
        of its RUN — so ``source`` is stamped on from the owning run here.
        """
        if all_runs:
            runs = (
                await self.session.execute(
                    select(LiveTradeRun).where(
                        LiveTradeRun.template_id == template_id,
                        LiveTradeRun.active == True,  # noqa: E712
                    )
                )
            ).scalars().all()
            if not runs:
                return []
            venue = {r.id: ("testnet" if r.is_testnet else "live") for r in runs}
            rows = (
                await self.session.execute(
                    select(LiveTrade)
                    .where(LiveTrade.run_id.in_(list(venue)))
                    .order_by(LiveTrade.entry_time.desc())
                    .limit(limit)
                )
            ).scalars().all()
            return [self._trade_response(tr, venue[tr.run_id]) for tr in rows]

        run = await self._current_run(template_id, run_id=run_id)
        if run is None:
            return []
        rows = (
            await self.session.execute(
                select(LiveTrade)
                .where(LiveTrade.run_id == run.id)
                .order_by(LiveTrade.trade_seq.desc())
                .limit(limit)
            )
        ).scalars().all()
        venue = "testnet" if run.is_testnet else "live"
        return [self._trade_response(tr, venue) for tr in rows]

    @staticmethod
    def _trade_response(trade: LiveTrade, venue: str) -> LiveTradeResponse:
        """One trade with its run's venue stamped on."""
        resp = LiveTradeResponse.model_validate(trade)
        resp.source = venue
        return resp

    async def _current_run(
        self, template_id: str, *, run_id: str | None = None
    ) -> LiveTradeRun | None:
        """The template's current live run: a RUNNING run wins over a more
        recently started but stopped one, else the latest.

        Ordering by ``started_at`` alone left ties undecided, so the pick could
        flip between requests the moment a template held more than one run — the
        same ambiguity the paper side had. The busiest run, then the lowest id,
        settle it. ``run_id`` short-circuits all of it, but only for a run that
        belongs to this template.
        """
        if run_id is not None:
            run = await self.session.get(LiveTradeRun, run_id)
            if run is None or not run.active or run.template_id != template_id:
                return None
            return run
        return (
            await self.session.execute(
                select(LiveTradeRun)
                .where(
                    LiveTradeRun.template_id == template_id,
                    LiveTradeRun.active == True,  # noqa: E712
                )
                .order_by(
                    (LiveTradeRun.status == "running").desc(),
                    LiveTradeRun.started_at.desc(),
                    LiveTradeRun.n_closed_trades.desc(),
                    LiveTradeRun.id.asc(),
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    async def account(self) -> LiveTradeAccountResponse:
        """Connectivity + balances for the Live page header (never raises)."""
        base = LiveTradeAccountResponse(
            configured=self.client.is_configured,
            testnet=self.client.is_testnet,
            base_url=self.client._base,
        )
        if not self.client.is_configured:
            return base
        try:
            acct = await self.client.account()
        except BinanceTradeError as exc:
            base.error = str(exc)[:300]
            return base
        base.can_trade = bool(acct.get("canTrade"))
        base.balances = {
            b["asset"]: float(b["free"])
            for b in acct.get("balances", [])
            if float(b["free"]) > 0
        }
        return base

    # ── P/L (identical differencing to paper) ─────────────────────────────────

    async def _compute_pnl(self, run: LiveTradeRun) -> LiveTradePnl:
        if run.equity is None or run.last_bar_time is None:
            return LiveTradePnl()
        equity = float(run.equity)
        pnl = LiveTradePnl(total=round(equity - float(run.initial_capital), 4))
        for field, window in _PNL_WINDOWS.items():
            past = await self._equity_at_or_before(run.id, run.last_bar_time - window)
            if past is not None:
                setattr(pnl, field, round(equity - past, 4))
        return pnl

    async def _equity_at_or_before(
        self, run_id: str, cutoff: datetime
    ) -> float | None:
        result = await self.session.execute(
            select(LiveTradeEquity.equity)
            .where(
                LiveTradeEquity.run_id == run_id,
                LiveTradeEquity.bar_time <= cutoff,
            )
            .order_by(LiveTradeEquity.bar_time.desc())
            .limit(1)
        )
        val = result.scalar_one_or_none()
        return float(val) if val is not None else None

    async def _to_response(
        self, run: LiveTradeRun, tpl: StrategyTemplate
    ) -> LiveTradeRunResponse:
        end = run.stopped_at or datetime.now(UTC)
        uptime_s = int((end - run.started_at).total_seconds()) if run.started_at else None
        return LiveTradeRunResponse(
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
            position="long" if run.open_side > 0 else None,
            error=run.error,
            is_testnet=run.is_testnet,
            cash_quote=float(run.cash_quote),
            open_qty=run.open_qty,
            pnl=await self._compute_pnl(run),
        )
