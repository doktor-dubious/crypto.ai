"""Seed a paired A/B sweep for the higher-timeframe trend gate.

The question the gate has to answer is "does requiring the bigger picture to
agree actually help", and the only honest way to answer it is to run the same
param-set twice — gate off and gate on — over the same coins in the same market
period, then read the DIFFERENCE. This script builds exactly that.

It works because the sweep's combo queue is coin-major (see
``services/paper_sweep.next_combos``): every template in a sweep runs on the
top-ranked coins first, so both members of a pair start on the same coin in the
same rotation wave. The leaderboard then matches them on (coin, wave) and
reports a paired t-statistic.

The variant template differs from its base ONLY in the ``htf*`` knobs — that is
what lets the leaderboard find the pairing with no extra column or naming
convention. Do not hand-edit anything else on it.

Usage
-----
    # Clone an existing sweep's templates + coin list into an A/B sweep
    uv run python scripts/seed_htf_ab_sweep.py --from-sweep <sweep_id>

    # Or name the templates explicitly, borrowing coins from a sweep
    uv run python scripts/seed_htf_ab_sweep.py \
        --from-sweep <sweep_id> --templates <id>,<id> --gate align --tf 4h

    # Add the counter-trend control arm as well (recommended: if it scores like
    # `align`, the gate is noise and you have learned the more useful thing)
    uv run python scripts/seed_htf_ab_sweep.py --from-sweep <id> --gate align,counter

Nothing starts trading until the hourly ``rotate_paper_sweeps`` beat picks the
sweep up (or you POST /paper-trade/sweeps/rotate). The sweep is created ENABLED
— pass --paused to stage it instead.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from crypto_ai.database.connection import async_session_factory
from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.paper_sweep import PaperSweep
from crypto_ai.database.models.strategy_template import StrategyTemplate
from crypto_ai.services.swing_analysis import TREND_GATES, htf_lookback_bars

# Suffix marking a generated variant. Cosmetic only — the leaderboard pairs on
# the params, never on the name.
_SUFFIX = "· HTF {gate} {tf}"


def _variant_name(base_name: str, gate: str, tf: str) -> str:
    return f"{base_name} {_SUFFIX.format(gate=gate, tf=tf)}"


async def _resolve_templates(session, sweep: PaperSweep | None, ids: list[str] | None):
    if ids:
        wanted = ids
    elif sweep is not None:
        wanted = list(sweep.template_ids or [])
    else:
        raise SystemExit("Need --from-sweep or --templates.")
    rows = (
        await session.execute(
            select(StrategyTemplate).where(
                StrategyTemplate.id.in_(wanted), StrategyTemplate.active.is_(True)
            )
        )
    ).scalars().all()
    found = {t.id: t for t in rows}
    missing = [i for i in wanted if i not in found]
    if missing:
        print(f"! skipping {len(missing)} unknown/inactive template(s): {missing}")
    # Preserve the caller's order.
    return [found[i] for i in wanted if i in found]


async def _resolve_coins(session, sweep: PaperSweep | None, symbols: list[str] | None):
    if symbols:
        rows = (
            await session.execute(
                select(Coin.id, Coin.symbol).where(Coin.symbol.in_(symbols))
            )
        ).all()
        by_symbol = {s: i for i, s in rows}
        missing = [s for s in symbols if s not in by_symbol]
        if missing:
            raise SystemExit(f"Unknown coin symbols: {missing}")
        return [by_symbol[s] for s in symbols]
    if sweep is not None and sweep.coin_ids:
        return list(sweep.coin_ids)
    raise SystemExit("Need --coins or a --from-sweep that has a coin list.")


async def seed(args: argparse.Namespace) -> None:
    gates = [g.strip() for g in args.gate.split(",") if g.strip()]
    for g in gates:
        if g not in TREND_GATES or g == "off":
            raise SystemExit(
                f"--gate must be one of {[g for g in TREND_GATES if g != 'off']}; got {g!r}"
            )

    async with async_session_factory() as session:
        sweep = (
            await session.get(PaperSweep, args.from_sweep) if args.from_sweep else None
        )
        if args.from_sweep and sweep is None:
            raise SystemExit(f"No sweep {args.from_sweep!r}")

        bases = await _resolve_templates(
            session, sweep, args.templates.split(",") if args.templates else None
        )
        if not bases:
            raise SystemExit("No usable base templates.")
        coin_ids = await _resolve_coins(
            session, sweep, args.coins.split(",") if args.coins else None
        )

        # Interleave base, variant(s), base, variant(s)… Combo order is
        # coin-major so the interleaving isn't what pairs them — but it keeps
        # the sweep's template list readable, and it means a fleet too small to
        # hold every template still holds BOTH ARMS of the pairs it does reach.
        template_ids: list[str] = []
        created = 0
        for base in bases:
            template_ids.append(base.id)
            base_params = dict(base.params or {})
            if (base_params.get("htfGate") or base_params.get("htf_gate")) not in (
                None, "off",
            ):
                print(f"! {base.name}: already gated — used as its own baseline arm")
            for gate in gates:
                name = _variant_name(base.name, gate, args.tf)
                params = {
                    **base_params,
                    "htfGate": gate,
                    "htfTf": args.tf,
                    "htfLevel": args.level,
                }
                existing = (
                    await session.execute(
                        select(StrategyTemplate).where(
                            StrategyTemplate.name == name,
                            StrategyTemplate.strategy == base.strategy,
                            StrategyTemplate.active.is_(True),
                        )
                    )
                ).scalar_one_or_none()
                if existing is not None:
                    # Re-running the script must not fork a second variant: the
                    # leaderboard would then pair the base against both.
                    existing.params = params
                    variant = existing
                else:
                    variant = StrategyTemplate(
                        name=name,
                        strategy=base.strategy,
                        params=params,
                        scope=dict(base.scope) if base.scope else None,
                        description=(
                            f"A/B variant of “{base.name}”: identical knobs plus the "
                            f"{gate} higher-timeframe gate at {args.tf} ≥ {args.level}σ. "
                            "Generated by scripts/seed_htf_ab_sweep.py — do not edit "
                            "any other knob or the pairing breaks."
                        ),
                        ai_confirmation=base.ai_confirmation,
                    )
                    session.add(variant)
                    created += 1
                await session.flush()
                template_ids.append(variant.id)

        interval = ((bases[0].scope or {}).get("interval")) or "?"
        bars = htf_lookback_bars(interval, args.tf)
        new_sweep = PaperSweep(
            name=args.name,
            enabled=not args.paused,
            template_ids=template_ids,
            coin_ids=coin_ids,
            max_concurrent=args.concurrent,
            dwell_days=args.dwell,
            initial_capital=args.capital,
        )
        session.add(new_sweep)
        await session.commit()

        print(f"\nsweep      {new_sweep.id}  “{new_sweep.name}”")
        print(f"enabled    {new_sweep.enabled}")
        print(f"arms       {len(bases)} base × {len(gates)} gate ({', '.join(gates)})")
        print(f"templates  {len(template_ids)} ({created} newly created)")
        print(f"coins      {len(coin_ids)}")
        print(f"combos     {len(template_ids) * len(coin_ids)} "
              f"@ {args.concurrent} concurrent, {args.dwell}d dwell")
        if bars:
            print(f"gate       {args.tf} on a {interval} scope = "
                  f"{bars} bar lookback, {bars + 200} bars of warmup")
        else:
            print(f"! {args.tf} is not above the base templates' {interval} scope — "
                  "the gate will be INERT and both arms will be identical.")
        print("\nRuns start on the next hourly rotation "
              "(or POST /api/v1/paper-trade/sweeps/rotate).")
        print("Read it on Paper Trade → Sweep → A/B pairs. Judge by the paired t "
              "(|t| ≥ 2 with n ≥ 10), never by a single pair.")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--from-sweep", help="Sweep id to borrow templates and coins from")
    p.add_argument("--templates", help="Comma-separated template ids (overrides --from-sweep's)")
    p.add_argument("--coins", help="Comma-separated coin SYMBOLS (overrides --from-sweep's)")
    p.add_argument("--gate", default="align",
                   help="Gate mode(s), comma-separated: align | flat | counter")
    p.add_argument("--tf", default="4h", help="Higher timeframe (default 4h)")
    p.add_argument("--level", type=float, default=0.5, help="Trend strength in σ")
    p.add_argument("--name", default="HTF gate A/B", help="Sweep name")
    p.add_argument("--concurrent", type=int, default=50)
    p.add_argument("--dwell", type=float, default=7.0, help="Days per combo")
    p.add_argument("--capital", type=float, default=100.0)
    p.add_argument("--paused", action="store_true", help="Create disabled")
    args = p.parse_args()
    if not args.from_sweep and not args.templates:
        p.error("need --from-sweep or --templates")
    try:
        asyncio.run(seed(args))
    except SystemExit as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
