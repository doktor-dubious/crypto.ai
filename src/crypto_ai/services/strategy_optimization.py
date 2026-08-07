"""Service layer for strategy parameter-grid optimizations.

Owns the CRUD, the coin resolution behind the "which coins" choice, and the cost
estimate the create dialog shows before anything is committed. Execution lives in
``strategy_optimization_runner`` and is driven by the Celery task in
``tasks/strategy_optimization.py``.
"""

from __future__ import annotations

import math
import random
from datetime import UTC, datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.coin_group import CoinGroup
from crypto_ai.database.models.coin_group_member import CoinGroupMember
from crypto_ai.database.models.strategy_optimization import (
    StrategyOptimization,
    StrategyOptimizationResult,
)
from crypto_ai.schemas.strategy_optimization import (
    OptimizationCreate,
    OptimizationEstimate,
    OptimizationResponse,
    OptimizationResultResponse,
    OptimizationUpdate,
)
from crypto_ai.services.kline_simulation_record import _interval_minutes
from crypto_ai.services.strategy_optimization_grid import (
    cartesian_size,
    count_param_combos,
)

# Sample-size floor for a result to be RANKED rather than merely listed. Matches
# the swing optimizer's rule: a handful of trades can post any per-trade number
# at all, and without a floor those combos crowd out every real one.
MIN_TRAIN_TRADES = 10
MIN_VAL_TRADES = 3

# Cost model, measured on this codebase (BTC, 2026-01-01..08-04, five intervals
# from 1d to 5m). Both parts scale LINEARLY with bar count, which is why a single
# per-combo constant was wrong by an order of magnitude in both directions: a
# combo costs 0.25 ms on 1d and 59 ms on 5m over the same calendar range.
#
#   context build   7.5 µs × bars fetched   (0.03 s on 1d → 7.2 s on 5m)
#   one combo       0.93 µs × bars in range (the trade loop, per bar)
#
# The fetch is bounded only at the top (everything up to end_date is loaded, so
# the trailing windows have their warmup), so it reads more bars than the range
# holds — how many more depends on the coin's listing date. _HISTORY_FACTOR is
# the middle of that spread rather than a measurement of any one coin.
_CTX_S_PER_BAR = 7.5e-6
_COMBO_S_PER_BAR = 0.93e-6
_HISTORY_FACTOR = 4.0
# Overhead outside the maths, backed out of completed runs: per market, task
# dispatch + session setup + the grid re-expansion; per combo, building and
# inserting its result row.
_MARKET_FIXED_S = 0.8
_COMBO_FIXED_S = 0.004
# Markets run as independent Celery children on a worker at concurrency 4, one
# slot of which is usually busy with the paper/live trading beats.
_PARALLEL_MARKETS = 3


class UnsupportedCoinModeError(ValueError):
    """A coin-selection mode that isn't implemented yet."""


class StrategyOptimizationService:
    """CRUD + coin resolution + cost estimates for grid searches."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Coin resolution ──────────────────────────────────────────────────────

    async def resolve_coins(self, sel: dict, seed: int) -> list[tuple[str, str]]:
        """(coin_id, quote_asset) pairs for a coin selection.

        Random picks are seeded so an optimization is reproducible and can be
        re-run on a later date range and still mean the same thing.
        """
        mode = sel.get("mode", "single")
        quote = sel.get("quote_asset") or "USDT"
        if mode == "liquidity":
            # Deferred: ranking by traded volume needs a metric the coin table
            # doesn't carry. Rejected loudly rather than quietly substituted.
            raise UnsupportedCoinModeError(
                "Ranking coins by liquidity isn't available yet — pick single, "
                "group, random or all."
            )
        if mode == "single":
            return [(sel["coin_id"], quote)] if sel.get("coin_id") else []
        if mode == "group":
            group = await self.session.get(CoinGroup, sel.get("group_id"))
            if group is None:
                return []
            # Membership lives in coin_group_members, not on the group row.
            # Ordered so the same group always expands to the same combo list.
            member_ids = (
                await self.session.execute(
                    select(CoinGroupMember.coin_id)
                    .where(CoinGroupMember.coin_group_id == group.id)
                    .order_by(CoinGroupMember.coin_id)
                )
            ).scalars().all()
            return [(cid, quote) for cid in member_ids]

        all_ids = (
            await self.session.execute(
                select(Coin.id).where(Coin.active == True).order_by(Coin.symbol)  # noqa: E712
            )
        ).scalars().all()
        if mode == "all":
            return [(cid, quote) for cid in all_ids]
        if mode == "random":
            picks = list(all_ids)
            random.Random(seed).shuffle(picks)
            return [(cid, quote) for cid in picks[: max(1, int(sel.get("count", 10)))]]
        return []

    # ── Estimate ─────────────────────────────────────────────────────────────

    async def estimate(self, data: OptimizationCreate) -> OptimizationEstimate:
        """What this spec would cost — the counter behind the create dialog."""
        spec = _spec_of(data)
        coins = await self.resolve_coins(data.coins.model_dump(), data.seed)
        n_markets = len(coins) * len(data.intervals)
        per = count_param_combos(spec)
        cartesian = cartesian_size(spec, len(coins), len(data.intervals))
        to_run = min(cartesian, data.max_combos)
        est = _estimate_seconds(
            intervals=list(data.intervals),
            n_coins=len(coins),
            n_combos=to_run,
            range_days=max(1, (data.end_date - data.start_date).days),
            per_market=per,
            cartesian=cartesian,
        )
        return OptimizationEstimate(
            n_markets=n_markets,
            n_param_combos=per,
            n_cartesian=cartesian,
            n_to_run=to_run,
            sampled=cartesian > data.max_combos,
            est_seconds=est,
        )

    # ── CRUD ─────────────────────────────────────────────────────────────────

    async def create(self, data: OptimizationCreate) -> StrategyOptimization:
        opt = StrategyOptimization(
            name=data.name.strip() or "Optimization",
            description=(data.description or "").strip() or None,
            notes=(data.notes or "").strip() or None,
            strategy=data.strategy,
            spec=_spec_of(data),
            start_date=data.start_date,
            end_date=data.end_date,
            seed=data.seed,
            max_combos=data.max_combos,
            status="pending",
        )
        self.session.add(opt)
        await self.session.flush()
        return opt

    async def get(self, opt_id: str) -> StrategyOptimization | None:
        return await self.session.get(StrategyOptimization, opt_id)

    async def list(self, strategy: str | None = None) -> list[OptimizationResponse]:
        stmt = select(StrategyOptimization).where(
            StrategyOptimization.active == True  # noqa: E712
        )
        if strategy:
            stmt = stmt.where(StrategyOptimization.strategy == strategy)
        rows = (
            await self.session.execute(stmt.order_by(StrategyOptimization.created_at.desc()))
        ).scalars().all()
        return [self._to_response(o) for o in rows]

    async def update(self, opt_id: str, data: OptimizationUpdate) -> StrategyOptimization | None:
        opt = await self.get(opt_id)
        if opt is None:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(opt, key, value)
        await self.session.flush()
        return opt

    async def delete(self, opt_id: str) -> bool:
        opt = await self.get(opt_id)
        if opt is None:
            return False
        opt.active = False
        await self.session.flush()
        return True

    async def results(self, opt_id: str, limit: int = 2000) -> list[OptimizationResultResponse]:
        """Every variation's score, best TRAIN edge first.

        Ranked on train because that is the half the search was allowed to look
        at; the validation columns beside it are the honest read.
        """
        rows = (
            await self.session.execute(
                select(StrategyOptimizationResult)
                .where(
                    StrategyOptimizationResult.optimization_id == opt_id,
                    StrategyOptimizationResult.active == True,  # noqa: E712
                )
                # Underpopulated combos still get listed — hiding them would be
                # its own kind of lie — but they sort below everything that
                # cleared the floor, so the top of the table is readable.
                .order_by(
                    case(
                        (
                            (StrategyOptimizationResult.train_n_trades >= MIN_TRAIN_TRADES)
                            & (StrategyOptimizationResult.val_n_trades >= MIN_VAL_TRADES),
                            0,
                        ),
                        else_=1,
                    ),
                    StrategyOptimizationResult.train_edge_t.desc(),
                )
                .limit(limit)
            )
        ).scalars().all()
        symbols = await self._symbols({r.coin_id for r in rows})
        out = []
        for r in rows:
            resp = OptimizationResultResponse.model_validate(r)
            resp.coin_symbol = symbols.get(r.coin_id)
            resp.qualified = (
                r.train_n_trades >= MIN_TRAIN_TRADES and r.val_n_trades >= MIN_VAL_TRADES
            )
            out.append(resp)
        return out

    async def _symbols(self, coin_ids: set[str]) -> dict[str, str]:
        if not coin_ids:
            return {}
        rows = (
            await self.session.execute(
                select(Coin.id, Coin.symbol).where(Coin.id.in_(coin_ids))
            )
        ).all()
        return {cid: sym for cid, sym in rows}

    def _to_response(self, o: StrategyOptimization) -> OptimizationResponse:
        resp = OptimizationResponse.model_validate(o)
        if o.started_at:
            end = o.finished_at or datetime.now(UTC)
            elapsed = max(0, int((end - o.started_at).total_seconds()))
            resp.elapsed_seconds = elapsed
            # ETA from the observed rate rather than the up-front estimate — the
            # per-combo cost varies enough between markets that only the run's
            # own pace is worth quoting.
            if o.status == "running" and o.n_done > 0 and o.n_total > o.n_done:
                rate = elapsed / o.n_done
                resp.eta_seconds = int(rate * (o.n_total - o.n_done))
        return resp


def _touched_markets(n_markets: int, per_market: int, cartesian: int, n_drawn: int) -> float:
    """How many markets a sampled grid actually lands on.

    Not ``n_markets``: drawing 900 combos across 1,700 markets leaves half of
    them with nothing, and a market with no combos is never dispatched at all.
    Since the draw is over distinct indices, a given market is missed only if all
    ``per_market`` of its indices are, so the expected hit count is
    ``M · (1 − (1 − k/cartesian)^per_market)`` — which collapses to ``k`` when
    each market holds one combo and to ``M`` once the budget dwarfs the grid.
    """
    if cartesian <= 0 or n_drawn >= cartesian or per_market <= 0:
        return float(n_markets)
    miss = math.exp(per_market * math.log1p(-n_drawn / cartesian))
    return n_markets * (1.0 - miss)


def _estimate_seconds(
    *, intervals: list[str], n_coins: int, n_combos: int, range_days: int,
    per_market: int = 1, cartesian: int = 0,
) -> int:
    """Wall-clock for a grid, from the measured per-bar costs above.

    Timeframe is the dominant term and it works the opposite way to intuition:
    ticking 5m alongside 1d multiplies the cost of that share of the grid by
    nearly 300, because a 5m market holds 288× the bars. So the estimate is built
    per interval rather than from an average, and combos are assumed to spread
    evenly over markets (which is what uniform sampling does).

    Wall-clock is not total work: markets are independent Celery children. But it
    can never beat the SLOWEST single market either — one 5m market's combos all
    run in one child, in sequence — so the estimate is the larger of the two.

    Accurate to roughly a factor of two on the runs it was fitted against. What
    it cannot see is queueing: a grid dispatched while another is still running
    waits for slots, and no static model predicts that.
    """
    intervals = intervals or ["15m"]
    n_markets = max(1, n_coins * len(intervals))
    touched = max(1.0, _touched_markets(n_markets, per_market, cartesian or n_combos, n_combos))
    # Combos and markets both spread evenly over the intervals, so one interval's
    # share is the whole grid divided by how many are ticked.
    coins_per_interval = touched / len(intervals)
    combos_per_market = n_combos / touched

    work = 0.0
    slowest = 0.0
    for interval in intervals:
        minutes = max(1, _interval_minutes(interval))
        bars = range_days * 1440 / minutes
        market = (
            _MARKET_FIXED_S
            + _CTX_S_PER_BAR * bars * _HISTORY_FACTOR
            + combos_per_market * (_COMBO_S_PER_BAR * bars + _COMBO_FIXED_S)
        )
        work += market * coins_per_interval
        slowest = max(slowest, market)
    return int(max(work / _PARALLEL_MARKETS, slowest))


def _spec_of(data: OptimizationCreate) -> dict:
    """The variation spec, stored whole so a re-run means the same thing."""
    return {
        # Recorded so the grid knows which strategy's knobs to expand. Specs
        # written before this are streak by definition — see _is_streak.
        "strategy": data.strategy,
        "coins": data.coins.model_dump(),
        "intervals": list(data.intervals),
        "threshold": list(data.threshold),
        "holdBars": list(data.holdBars),
        "sides": list(data.sides),
        "voldiv": list(data.voldiv),
        "btcFilter": list(data.btcFilter),
        "volGate": list(data.volGate),
        "htfGate": list(data.htfGate),
        "slModes": list(data.slModes),
        "slValues": dict(data.slValues),
        "tpModes": list(data.tpModes),
        "tpValues": dict(data.tpValues),
        "paramAxes": {k: list(v) for k, v in (data.paramAxes or {}).items() if v},
        "signalSubsets": list(data.signalSubsets),
        "indicators": list(data.indicators),
        "indicatorValues": {k: dict(v) for k, v in (data.indicatorValues or {}).items()},
        "fixed": dict(data.fixed),
        "baseline": dict(data.baseline or {}),
        "baseline_params": dict(data.baseline_params or {}),
    }


async def count_results(session: AsyncSession, opt_id: str) -> int:
    return int(
        (
            await session.execute(
                select(func.count(StrategyOptimizationResult.id)).where(
                    StrategyOptimizationResult.optimization_id == opt_id
                )
            )
        ).scalar()
        or 0
    )
