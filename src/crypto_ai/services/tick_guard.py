"""Tick-size guard: which coins' price grids are too coarse to trade.

The exchange tick size isn't stored, so it is estimated from recent klines:
the smallest non-zero move observed over the coin's last ``TICK_WINDOW_DAYS``
of 5m bars — bar-to-bar close change or intra-bar high−low. A coin fails the
guard when that step exceeds ``sweep_max_tick_pct`` of its price. There a
single tick dwarfs any realistic edge, and the spread — necessarily at least
one tick — makes close-fill paper P/L unrealizable: BTTC trades at
0.00000026/0.00000027, so every "win" is one tick = ~3.8% that a live order
would give straight back crossing the spread. A coin that never moved at all
inside the window (a dead market) fails too.

The window is anchored at each coin's own newest 5m bar, not at wall-clock
now. A coin whose ingestion stopped (its sweep runs ended, so live ingest
dropped it) must keep its verdict — under a now-anchored window it would age
out of the data within days and silently pass, re-admitting exactly the
historical runs the guard exists to exclude. Only coins with fewer than
``TICK_MIN_BARS`` bars ever recorded fail open (too little data to tell a
coarse grid from a data gap).

Consumers: sweep rotation (skip these coins), the sweep leaderboard (drop
their runs from every stat) and the Paper Trade / Strategies pages (filter
runs, warn on the detail pane).
"""

import time
from collections.abc import Iterable
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.config import get_settings
from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.kline import Kline

# Window of recent bars the tick-size estimate is read from, and the bar count
# below which a coin is not judged at all (too little data to tell a coarse
# grid from a data gap — fail open rather than exclude blindly).
TICK_WINDOW_DAYS = 7
TICK_MIN_BARS = 50
TICK_INTERVAL = "5m"  # tick size is a property of the symbol, not the timeframe

# Verdicts only move as new 5m bars land — a ~daily timescale — but the guard
# is consulted by polled endpoints, every Analyze request and the sweep beat.
# Without a cache each of those rescans a week of klines per coin.
_CACHE_TTL_SECONDS = 15 * 60
_verdicts: dict[str, tuple[float, bool]] = {}  # coin_id -> (expires_at, limited)


async def tick_limited_coins(
    session: AsyncSession, coin_ids: Iterable[str | None]
) -> set[str]:
    """The subset of ``coin_ids`` that currently fails the tick guard."""
    ids = sorted({c for c in coin_ids if c})
    if not ids:
        return set()
    now = time.monotonic()
    limited: set[str] = set()
    misses: list[str] = []
    for coin_id in ids:
        cached = _verdicts.get(coin_id)
        if cached is not None and cached[0] > now:
            if cached[1]:
                limited.add(coin_id)
        else:
            misses.append(coin_id)
    if not misses:
        return limited

    # Each coin's window is [its newest bar − TICK_WINDOW_DAYS, its newest
    # bar]. Fetched first so the per-coin cutoffs can be computed in Python —
    # portable, and the bars query then reads only the windows it needs.
    last_bar = dict(
        (
            await session.execute(
                select(Kline.coin_id, func.max(Kline.open_time))
                .where(
                    Kline.coin_id.in_(misses),
                    Kline.quote_asset == "USDT",
                    Kline.interval == TICK_INTERVAL,
                )
                .group_by(Kline.coin_id)
            )
        ).all()
    )
    # Coins with no 5m USDT bars at all can't be judged — fail open.
    verdicts: dict[str, bool] = {c: False for c in misses}
    if last_bar:
        window = timedelta(days=TICK_WINDOW_DAYS)
        prev_close = func.lag(Kline.close).over(
            partition_by=Kline.coin_id, order_by=Kline.open_time
        )
        bars = (
            select(
                Kline.coin_id.label("coin_id"),
                Kline.close.label("close"),
                (Kline.high - Kline.low).label("bar_range"),
                func.abs(Kline.close - prev_close).label("close_step"),
            )
            .where(
                Kline.quote_asset == "USDT",
                Kline.interval == TICK_INTERVAL,
                or_(
                    *[
                        and_(Kline.coin_id == c, Kline.open_time >= t - window)
                        for c, t in last_bar.items()
                    ]
                ),
            )
            .subquery()
        )
        rows = await session.execute(
            select(
                bars.c.coin_id,
                func.count().label("n_bars"),
                func.min(case((bars.c.close_step > 0, bars.c.close_step))).label(
                    "min_close_step"
                ),
                func.min(case((bars.c.bar_range > 0, bars.c.bar_range))).label(
                    "min_bar_range"
                ),
                func.max(bars.c.close).label("ref_price"),
            ).group_by(bars.c.coin_id)
        )
        max_pct = get_settings().sweep_max_tick_pct
        for coin_id, n_bars, min_close_step, min_bar_range, ref_price in rows.all():
            if n_bars < TICK_MIN_BARS or not ref_price:
                continue
            steps = [float(s) for s in (min_close_step, min_bar_range) if s is not None]
            step = min(steps) if steps else None
            verdicts[str(coin_id)] = (
                step is None or step / float(ref_price) * 100.0 > max_pct
            )

    expires = now + _CACHE_TTL_SECONDS
    for coin_id, is_limited in verdicts.items():
        _verdicts[coin_id] = (expires, is_limited)
    limited.update(c for c, v in verdicts.items() if v)
    return limited


def scope_coin_id(obj: Any) -> str | None:
    """The coin id out of a run's or template's ``scope`` blob, as the string
    form the guard and its callers compare on."""
    scope = getattr(obj, "scope", None) or {}
    coin_id = scope.get("coin_id")
    return str(coin_id) if coin_id else None


async def coin_symbols(
    session: AsyncSession, coin_ids: Iterable[str | None]
) -> dict[str, str]:
    """Coin id → ticker symbol (ids are meaningless in a UI or a log line)."""
    ids = [c for c in {c for c in coin_ids if c}]
    if not ids:
        return {}
    rows = await session.execute(
        select(Coin.id, Coin.symbol).where(Coin.id.in_(ids))
    )
    return {str(coin_id): symbol for coin_id, symbol in rows.all()}


async def partition_tick_limited(
    session: AsyncSession, runs: list
) -> tuple[list, list, list[str]]:
    """Split scoped runs by the tick guard: (kept, excluded, excluded symbols).

    One place for the ritual every consumer of the guard repeats — read each
    run's coin from its scope, ask the guard, split, and name what was dropped
    so the exclusion is reportable rather than silent.
    """
    limited = await tick_limited_coins(session, (scope_coin_id(r) for r in runs))
    kept = [r for r in runs if scope_coin_id(r) not in limited]
    excluded = [r for r in runs if scope_coin_id(r) in limited]
    symbols = await coin_symbols(session, {scope_coin_id(r) for r in excluded})
    return kept, excluded, sorted(symbols.values())
