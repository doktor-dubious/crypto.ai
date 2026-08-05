"""Performance analysis of a strategy template's paper trades.

Loads the template's closed paper trades — pooled across every run by default —
and hands them to the shared bucketing in ``services/trade_buckets.py``, which
owns the statistics and the caveats. Returns are the fee-inclusive per-trade
``ret``, which is capital- and coin-independent, so a template swept across many
coins pools honestly; quote P/L is summed too but only comparable within a run.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.paper_trade import PaperTrade
from crypto_ai.database.models.paper_trade_run import PaperTradeRun
from crypto_ai.database.models.strategy_template import StrategyTemplate
from crypto_ai.schemas.paper_trade_analysis import BucketStat, PaperTradeAnalysis
from crypto_ai.services.trade_buckets import BucketInput, build_bucket_analysis


class PaperTradeAnalysisService:
    """Bucketed performance stats for one strategy template's paper trades."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def analyze(
        self,
        template_id: str,
        *,
        scope: str = "template",
        tz_offset_minutes: int = 0,
    ) -> PaperTradeAnalysis | None:
        """Analyse the template's trades. ``scope="run"`` restricts to the
        current run (the one the Trades tab shows), ``"template"`` pools every
        run. Time-of-day buckets are shifted by ``tz_offset_minutes`` so the UI
        can show local time; sessions and weekdays stay UTC. Returns None if the
        template no longer exists."""
        template = await self.session.get(StrategyTemplate, template_id)
        if template is None:
            return None

        runs = (
            await self.session.execute(
                select(PaperTradeRun)
                .where(
                    PaperTradeRun.template_id == template_id,
                    PaperTradeRun.active == True,  # noqa: E712
                )
                # Same ordering as PaperTradeService._current_run: sweep
                # fan-outs create many runs with identical status and
                # started_at, and without the tie-breakers the "current run"
                # here could be a different run than the Trades tab shows.
                .order_by(
                    (PaperTradeRun.status == "running").desc(),
                    PaperTradeRun.started_at.desc(),
                    PaperTradeRun.n_closed_trades.desc(),
                    PaperTradeRun.id.asc(),
                )
            )
        ).scalars().all()
        if scope == "run":
            runs = runs[:1]

        def identify(
            analysis: PaperTradeAnalysis, n_open: int, coins: list[str]
        ) -> PaperTradeAnalysis:
            analysis.template_id = template_id
            analysis.template_name = template.name
            analysis.n_runs = len(runs)
            analysis.n_open = n_open
            analysis.coins = coins
            return analysis

        empty = PaperTradeAnalysis(
            scope=scope,
            tz_offset_minutes=tz_offset_minutes,
            overall=BucketStat(key="all", label="All trades"),
        )
        if not runs:
            return identify(empty, 0, [])

        run_ids = [r.id for r in runs]
        trades = (
            await self.session.execute(
                select(PaperTrade)
                .where(
                    PaperTrade.run_id.in_(run_ids),
                    PaperTrade.active == True,  # noqa: E712
                )
                .order_by(PaperTrade.entry_time)
            )
        ).scalars().all()

        closed = [tr for tr in trades if tr.status == "closed" and tr.ret is not None]
        n_open = len(trades) - len(closed)
        coins = await self._symbols(
            {str(r.scope["coin_id"]) for r in runs if r.scope and r.scope.get("coin_id")}
        )
        if not closed:
            return identify(empty, n_open, coins)

        analysis = build_bucket_analysis(
            [
                BucketInput(
                    entry_time=tr.entry_time,
                    ret_bps=float(tr.ret) * 10_000.0,
                    side=tr.side,
                    exit_reason=tr.exit_reason,
                    pnl=float(tr.realized_pnl or 0.0),
                )
                for tr in closed
            ],
            tz_offset_minutes=tz_offset_minutes,
            scope=scope,
        )
        return identify(analysis, n_open, coins)

    async def _symbols(self, coin_ids: set[str]) -> list[str]:
        """Ticker symbols for the pooled runs' coins (ids are meaningless in a UI)."""
        if not coin_ids:
            return []
        rows = (
            await self.session.execute(
                select(Coin.symbol).where(Coin.id.in_(coin_ids))
            )
        ).scalars().all()
        return sorted(rows)
