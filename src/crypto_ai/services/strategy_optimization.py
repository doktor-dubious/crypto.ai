"""Service layer for strategy parameter-grid optimizations.

Owns the CRUD, the coin resolution behind the "which coins" choice, and the cost
estimate the create dialog shows before anything is committed. Execution lives in
``strategy_optimization_runner`` and is driven by the Celery task in
``tasks/strategy_optimization.py``.
"""

from __future__ import annotations

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
from crypto_ai.services.strategy_optimization_grid import (
    cartesian_size,
    count_param_combos,
)

# Sample-size floor for a result to be RANKED rather than merely listed. Matches
# the swing optimizer's rule: a handful of trades can post any per-trade number
# at all, and without a floor those combos crowd out every real one.
MIN_TRAIN_TRADES = 10
MIN_VAL_TRADES = 3

# Measured on this codebase: ~15 ms per combo once a market's context is built
# (the score arrays are cached per gate combination, so only the trade loop
# re-runs), and a couple of seconds to build that context. Both are estimates for
# a warning, not promises — a year of 5m bars costs more than a month of 1d.
_MS_PER_COMBO = 15
_SECONDS_PER_MARKET = 2.5


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
        est = int(n_markets * _SECONDS_PER_MARKET + to_run * _MS_PER_COMBO / 1000)
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
