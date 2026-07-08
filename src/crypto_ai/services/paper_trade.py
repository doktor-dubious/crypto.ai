"""Service layer for paper-trade runs.

Manages the start→stop lifecycle of running strategy templates (one running run
per template) and reads back the state the execution engine
(``paper_trade_engine.py``) maintains: mark-to-market equity, open position,
trade count, and time-bucketed P/L differenced from the equity snapshots.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.paper_trade import PaperTrade
from crypto_ai.database.models.paper_trade_equity import PaperTradeEquity
from crypto_ai.database.models.paper_trade_run import PaperTradeRun
from crypto_ai.database.models.strategy_template import StrategyTemplate
from crypto_ai.schemas.paper_trade import (
    PaperTradePnl,
    PaperTradeResponse,
    PaperTradeRunResponse,
)

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


class PaperTradeService:
    """Start/stop/list paper-trade runs and surface their engine-computed P/L."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _running_for(self, template_id: str) -> PaperTradeRun | None:
        result = await self.session.execute(
            select(PaperTradeRun).where(
                PaperTradeRun.template_id == template_id,
                PaperTradeRun.status == "running",
                PaperTradeRun.active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def start(
        self, template_id: str, initial_capital: float = 100.0
    ) -> PaperTradeRun | None:
        """Start a run for a template with the given paper investment (quote
        currency). Idempotent — returns the existing running run if one already
        exists (its investment is unchanged). Returns None if the template is gone."""
        template = await self.session.get(StrategyTemplate, template_id)
        if template is None or not template.active:
            return None
        existing = await self._running_for(template_id)
        if existing is not None:
            return existing
        # Freeze the template config onto the run so a later edit/delete of the
        # template never rewrites this run's trade history.
        run = PaperTradeRun(
            template_id=template_id,
            status="running",
            initial_capital=max(0.0, float(initial_capital)),
            template_name=template.name,
            strategy=template.strategy,
            scope=template.scope,
            params=template.params,
        )
        self.session.add(run)
        await self.session.flush()
        return run

    async def stop(self, template_id: str) -> PaperTradeRun | None:
        """Stop the running run for a template (if any)."""
        run = await self._running_for(template_id)
        if run is None:
            return None
        run.status = "stopped"
        run.stopped_at = datetime.now(UTC)
        await self.session.flush()
        return run

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
        self, template_id: str, limit: int = 500
    ) -> list[PaperTradeResponse]:
        """Trades for a template's current (or most recent) run, newest first."""
        run = await self._running_for(template_id)
        if run is None:
            run = (
                await self.session.execute(
                    select(PaperTradeRun)
                    .where(
                        PaperTradeRun.template_id == template_id,
                        PaperTradeRun.active == True,  # noqa: E712
                    )
                    .order_by(PaperTradeRun.started_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
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
