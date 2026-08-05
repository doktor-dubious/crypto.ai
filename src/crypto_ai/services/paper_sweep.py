"""Service layer for paper-trade sweeps (rotating strategy×coin searches).

A sweep keeps up to ``max_concurrent`` (template × coin) combos running as
paper-trade runs. ``rotate()`` — called hourly by Celery beat — stops runs past
their dwell time and tops the fleet back up with the next untried combos from
the sweep's coin-major queue. A combo counts as tried as soon as any run tagged
with the sweep exists for it, so rotation is stateless and idempotent.

The leaderboard pools results per template across coins (the statistically
meaningful grouping) and lists the best/worst individual runs.
"""

import json
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.paper_sweep import PaperSweep
from crypto_ai.database.models.paper_trade_run import PaperTradeRun
from crypto_ai.schemas.paper_sweep import (
    SweepLeaderboard,
    SweepPairStat,
    SweepRunStat,
    SweepStatus,
    SweepTemplateCoin,
    SweepTemplateStat,
)
from crypto_ai.services.paper_trade import PaperTradeService
from crypto_ai.services.swing_analysis import _t_stat

log = structlog.get_logger()

# Knob prefix identifying the higher-timeframe gate. Two templates that differ
# ONLY in these keys are an A/B pair — an exact structural test, so no naming
# convention or extra column is needed to link a variant to its baseline.
_GATE_PREFIX = "htf"


def _without_gate(params: dict | None) -> str:
    """Canonical form of a param blob with the gate knobs removed."""
    rest = {
        k: v for k, v in (params or {}).items()
        if not k.lower().lstrip("_").startswith(_GATE_PREFIX)
    }
    return json.dumps(rest, sort_keys=True, default=str)


def _gate_of(params: dict | None) -> str | None:
    """"align 4h (0.5σ)" — or None when this template's gate is off."""
    p = params or {}
    gate = p.get("htfGate") or p.get("htf_gate") or "off"
    if gate == "off":
        return None
    tf = p.get("htfTf") or p.get("htf_tf") or "4h"
    level = p.get("htfLevel", p.get("htf_level", 0.5))
    return f"{gate} {tf} ({level}σ)"


def next_combos(
    template_ids: list[str],
    coin_ids: list[str],
    taken: set[tuple[str, str]],
    slots: int,
) -> list[tuple[str, str]]:
    """The next ``slots`` untried (template_id, coin_id) combos, coin-major.

    Coin-major order means the whole template set runs on the best-ranked coins
    first, so every template accrues pooled evidence over the SAME coins.
    """
    if slots <= 0:
        return []
    out: list[tuple[str, str]] = []
    for coin_id in coin_ids:
        for template_id in template_ids:
            if (template_id, coin_id) in taken:
                continue
            out.append((template_id, coin_id))
            if len(out) >= slots:
                return out
    return out


def _gate_pairs(
    by_template: dict[str, list[PaperTradeRun]], pnl_pct,
) -> list[SweepPairStat]:
    """A/B standings for templates that differ only in the trend gate.

    Runs are matched on (coin, rotation wave) — the wave being ``started_at``
    bucketed to the hour, since rotation is hourly — so the two arms are always
    compared over the same coin AND the same market period. That is what makes
    the paired t-statistic meaningful; comparing pooled averages across
    different coins and windows would mostly measure the market.
    """
    # {(strategy, params-minus-gate): {gate-or-None: run list}}
    families: dict[tuple[str, str], dict[str | None, list[PaperTradeRun]]] = {}
    for runs in by_template.values():
        head = runs[0]
        key = (head.strategy or "?", _without_gate(head.params))
        families.setdefault(key, {}).setdefault(_gate_of(head.params), []).extend(runs)

    def wave_key(r: PaperTradeRun) -> tuple:
        return (r.scope or {}).get("coin_id"), r.started_at.replace(
            minute=0, second=0, microsecond=0
        )

    out: list[SweepPairStat] = []
    for (strategy, _params), by_gate in families.items():
        base_runs = by_gate.get(None)
        if not base_runs:
            continue  # nothing to compare the gated variants against
        base_by_wave = {wave_key(r): r for r in base_runs}
        for gate, var_runs in by_gate.items():
            if gate is None:
                continue
            matched = [
                (base_by_wave[k], v)
                for v in var_runs
                if (k := wave_key(v)) in base_by_wave
            ]
            if not matched:
                continue
            deltas = [pnl_pct(v) - pnl_pct(b) for b, v in matched]
            n = len(matched)
            out.append(
                SweepPairStat(
                    base_template_id=matched[0][0].template_id,
                    base_template_name=matched[0][0].template_name or "?",
                    variant_template_id=matched[0][1].template_id,
                    variant_template_name=matched[0][1].template_name or "?",
                    strategy=strategy,
                    variant_gate=gate,
                    n_paired=n,
                    base_avg_pnl_pct=round(sum(pnl_pct(b) for b, _ in matched) / n, 3),
                    variant_avg_pnl_pct=round(sum(pnl_pct(v) for _, v in matched) / n, 3),
                    delta_avg_pnl_pct=round(sum(deltas) / n, 3),
                    delta_t=round(_t_stat(deltas), 2),
                    base_trades=sum(b.n_closed_trades for b, _ in matched),
                    variant_trades=sum(v.n_closed_trades for _, v in matched),
                )
            )
    out.sort(key=lambda p: abs(p.delta_t), reverse=True)
    return out


class PaperSweepService:
    """Rotate sweep fleets and report their standings."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Rotation ─────────────────────────────────────────────────────────────

    async def rotate(self) -> dict:
        """One rotation pass over every enabled sweep. Commits per sweep."""
        sweeps = (
            await self.session.execute(
                select(PaperSweep).where(
                    PaperSweep.enabled.is_(True), PaperSweep.active.is_(True)
                )
            )
        ).scalars().all()
        totals = {"sweeps": len(sweeps), "stopped": 0, "started": 0}
        for sweep in sweeps:
            stopped, started = await self._rotate_one(sweep)
            await self.session.commit()
            totals["stopped"] += stopped
            totals["started"] += started
        return totals

    async def _rotate_one(self, sweep: PaperSweep) -> tuple[int, int]:
        now = datetime.now(UTC)
        cutoff = now - timedelta(days=float(sweep.dwell_days))
        runs = (
            await self.session.execute(
                select(PaperTradeRun).where(
                    PaperTradeRun.sweep_id == sweep.id,
                    PaperTradeRun.active.is_(True),
                )
            )
        ).scalars().all()

        stopped = 0
        for run in runs:
            if run.status == "running" and run.started_at <= cutoff:
                run.status = "stopped"
                run.stopped_at = now
                stopped += 1

        running = sum(1 for r in runs if r.status == "running")
        taken = {
            (r.template_id, (r.scope or {}).get("coin_id"))
            for r in runs
            if (r.scope or {}).get("coin_id")
        }
        combos = next_combos(
            list(sweep.template_ids or []),
            list(sweep.coin_ids or []),
            taken,
            int(sweep.max_concurrent) - running,
        )

        trade_service = PaperTradeService(self.session)
        started = 0
        for template_id, coin_id in combos:
            run = await trade_service.start(
                template_id,
                initial_capital=float(sweep.initial_capital),
                coin_id=coin_id,
                sweep_id=sweep.id,
            )
            if run is None:  # template deleted mid-sweep — skip, don't retry forever
                log.warning(
                    "paper_sweep.template_missing",
                    sweep_id=sweep.id,
                    template_id=template_id,
                )
                continue
            started += 1
        if stopped or started:
            log.info(
                "paper_sweep.rotated",
                sweep_id=sweep.id,
                name=sweep.name,
                stopped=stopped,
                started=started,
                running=running - stopped + started,
            )
        return stopped, started

    async def advance(self, sweep_id: str) -> dict | None:
        """Force a wave swap: stop ALL of the sweep's running runs regardless of
        age, then top back up with the next untried combos. Explicit user action
        (guarded in the UI), so it works even on a paused sweep. None if gone."""
        sweep = await self.session.get(PaperSweep, sweep_id)
        if sweep is None or not sweep.active:
            return None
        now = datetime.now(UTC)
        runs = (
            await self.session.execute(
                select(PaperTradeRun).where(
                    PaperTradeRun.sweep_id == sweep.id,
                    PaperTradeRun.status == "running",
                    PaperTradeRun.active.is_(True),
                )
            )
        ).scalars().all()
        for run in runs:
            run.status = "stopped"
            run.stopped_at = now
        await self.session.flush()
        _, started = await self._rotate_one(sweep)
        await self.session.commit()
        log.info(
            "paper_sweep.advanced",
            sweep_id=sweep.id,
            name=sweep.name,
            stopped=len(runs),
            started=started,
        )
        return {"stopped": len(runs), "started": started}

    # ── Reporting ────────────────────────────────────────────────────────────

    async def list_sweeps(self) -> list[SweepStatus]:
        sweeps = (
            await self.session.execute(
                select(PaperSweep)
                .where(PaperSweep.active.is_(True))
                .order_by(PaperSweep.created_at.desc())
            )
        ).scalars().all()
        out = []
        for sweep in sweeps:
            runs = (
                await self.session.execute(
                    select(PaperTradeRun.status).where(
                        PaperTradeRun.sweep_id == sweep.id,
                        PaperTradeRun.active.is_(True),
                    )
                )
            ).scalars().all()
            out.append(
                SweepStatus(
                    id=sweep.id,
                    name=sweep.name,
                    enabled=sweep.enabled,
                    max_concurrent=sweep.max_concurrent,
                    dwell_days=sweep.dwell_days,
                    initial_capital=sweep.initial_capital,
                    n_templates=len(sweep.template_ids or []),
                    n_coins=len(sweep.coin_ids or []),
                    n_combos_total=len(sweep.template_ids or []) * len(sweep.coin_ids or []),
                    n_combos_tried=len(runs),
                    n_running=sum(1 for s in runs if s == "running"),
                )
            )
        return out

    async def set_enabled(self, sweep_id: str, enabled: bool) -> PaperSweep | None:
        sweep = await self.session.get(PaperSweep, sweep_id)
        if sweep is None or not sweep.active:
            return None
        sweep.enabled = enabled
        await self.session.flush()
        return sweep

    async def leaderboard(self, sweep_id: str | None = None, top: int = 20) -> SweepLeaderboard:
        """Per-template pooled standings + best/worst individual runs.

        Aggregated in Python: the fleet grows ~max_concurrent runs per dwell
        period, so even a year of sweeping is a few thousand rows.
        """
        stmt = select(PaperTradeRun).where(
            PaperTradeRun.sweep_id.is_not(None),
            PaperTradeRun.active.is_(True),
        )
        if sweep_id is not None:
            stmt = select(PaperTradeRun).where(
                PaperTradeRun.sweep_id == sweep_id,
                PaperTradeRun.active.is_(True),
            )
        runs = (await self.session.execute(stmt)).scalars().all()
        runs = [r for r in runs if r.equity is not None and r.initial_capital]

        symbols = await self._symbols({(r.scope or {}).get("coin_id") for r in runs})
        now = datetime.now(UTC)

        def pnl_pct(r: PaperTradeRun) -> float:
            return (float(r.equity) - float(r.initial_capital)) / float(r.initial_capital) * 100.0

        by_template: dict[str, list[PaperTradeRun]] = {}
        for r in runs:
            by_template.setdefault(r.template_id, []).append(r)

        template_stats = []
        for template_id, trs in by_template.items():
            pnls = sorted(pnl_pct(r) for r in trs)
            n = len(pnls)
            template_stats.append(
                SweepTemplateStat(
                    template_id=template_id,
                    template_name=trs[0].template_name or "?",
                    strategy=trs[0].strategy or "?",
                    n_runs=n,
                    n_running=sum(1 for r in trs if r.status == "running"),
                    avg_pnl_pct=round(sum(pnls) / n, 3),
                    median_pnl_pct=round(
                        pnls[n // 2] if n % 2 else (pnls[n // 2 - 1] + pnls[n // 2]) / 2, 3
                    ),
                    win_rate_pct=round(100.0 * sum(1 for p in pnls if p > 0) / n, 1),
                    total_trades=sum(r.n_closed_trades for r in trs),
                    total_pnl_quote=round(
                        sum(float(r.equity) - float(r.initial_capital) for r in trs), 2
                    ),
                    coins=[
                        SweepTemplateCoin(
                            symbol=symbols.get(
                                (r.scope or {}).get("coin_id"),
                                (r.scope or {}).get("coin_id") or "?",
                            ),
                            status=r.status,
                            pnl_pct=round(pnl_pct(r), 2),
                            n_trades=r.n_closed_trades,
                        )
                        for r in sorted(trs, key=pnl_pct, reverse=True)
                    ],
                )
            )
        template_stats.sort(key=lambda t: t.avg_pnl_pct, reverse=True)

        def run_stat(r: PaperTradeRun) -> SweepRunStat:
            scope = r.scope or {}
            end = r.stopped_at or now
            return SweepRunStat(
                run_id=r.id,
                template_id=r.template_id,
                template_name=r.template_name or "?",
                strategy=r.strategy or "?",
                coin_symbol=symbols.get(scope.get("coin_id"), scope.get("coin_id") or "?"),
                interval=scope.get("interval") or "?",
                status=r.status,
                started_at=r.started_at,
                days=round((end - r.started_at).total_seconds() / 86400.0, 2),
                pnl_pct=round(pnl_pct(r), 3),
                n_trades=r.n_closed_trades,
            )

        ranked = sorted(runs, key=pnl_pct, reverse=True)
        return SweepLeaderboard(
            n_runs=len(runs),
            templates=template_stats,
            pairs=_gate_pairs(by_template, pnl_pct),
            top_runs=[run_stat(r) for r in ranked[:top]],
            bottom_runs=[run_stat(r) for r in ranked[-top:]][::-1] if runs else [],
        )

    async def _symbols(self, coin_ids: set[str | None]) -> dict[str, str]:
        ids = [c for c in coin_ids if c]
        if not ids:
            return {}
        rows = await self.session.execute(
            select(Coin.id, Coin.symbol).where(Coin.id.in_(ids))
        )
        return dict(rows.all())
