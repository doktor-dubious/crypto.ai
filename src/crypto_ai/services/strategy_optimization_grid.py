"""Turning a variation spec into the list of backtests to actually run.

Kept apart from the runner so the expansion is testable on its own and so the
frontend's live combo counter and the backend agree on one definition of "how
many combos is this".

Two rules do real work here:

  * **Degenerate settings collapse.** ``slMode: "none"`` ignores ``slValue``, so
    it contributes ONE combo, not one per value on the ladder. Without this the
    grid multiplies out settings that produce bit-identical backtests.
  * **Over budget, the grid is SAMPLED, not truncated.** Truncating an ordered
    cartesian explores one corner of the space exhaustively and the rest not at
    all. Random search over the same budget covers every dimension — the
    standard result once a space has this many axes — and a fixed seed keeps it
    reproducible.
"""

from __future__ import annotations

import random
from collections.abc import Iterable, Sequence
from itertools import product
from typing import Any

# The exit ladders. ATR multiples lead because they self-scale: a fixed 1% stop
# means something completely different on BTC than on a sub-cent token, and an
# optimization spans coins. Fixed percentages are kept for single-coin work but
# sized for scalping — a 5% stop on a 6-bar 5m hold never triggers, which just
# reproduces "no stop" under another name.
SL_PCT_LADDER = (0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0)
SL_ATR_LADDER = (1.0, 1.5, 2.0, 2.5, 3.0)
TP_PCT_LADDER = (0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0)

# Which knobs each indicator kind actually reads. Pairing them matters: sweeping
# `period` while the kind is EMA produces bit-identical backtests, because EMA
# never looks at it — the same degenerate multiplication the exit ladders avoid.
_INDICATOR_PARAMS: dict[str, tuple[str, ...]] = {
    "ema": ("fast", "slow"),
    "rsi": ("period",),
    "bollinger": ("period",),
    "vwap": ("vwap_window",),
}
_INDICATOR_DEFAULTS = {"fast": 9.0, "slow": 21.0, "period": 14.0, "vwap_window": 96.0}

# Swings is driven by WHICH composite members vote, so its signal axis is a set
# of named subsets rather than a numeric ladder. Stored as `disabledSignals` —
# the same field the swings explorer uses — so a variation applies straight back
# onto the page. Kept in sync with COMPONENT_KEYS/FLAG_KEYS in swing_analysis.
_SWING_ALL = (
    "streak", "volume", "range", "trades", "avg_trade", "wick", "taker", "stretch",
    "sweep", "voldiv", "decel",
)
SWING_SUBSETS: dict[str, tuple[str, ...]] = {
    "all": _SWING_ALL,
    # Climax detection: participation/violence spikes plus confirming flags.
    "spikes": ("volume", "range", "trades", "avg_trade", "sweep", "voldiv"),
    # Directional exhaustion: who is pushing, how stretched, how tired.
    "direction": ("streak", "wick", "taker", "stretch", "sweep", "decel"),
}

# Two composite modes that answer "is each member earning its place?" without
# searching the full 11-dimensional weight space — which is 3^11 combos at even a
# coarse three levels, costs 3.2x per combo (varying weights defeats the score
# cache, so every combo recomputes the composite instead of only the trade loop),
# and fits eleven continuous knobs to one half of the data.
#
#   leave_one_out  disable exactly one member, eleven ways. Anything whose
#                  REMOVAL improves the result is dead weight.
#   weight_oat     scale one member's contribution, the other ten unchanged.
#
# Both are read against all eleven members, exactly as the named subsets are —
# they describe the composite outright rather than adjusting whatever the page
# currently has switched off.
SWING_MODES = ("leave_one_out", "weight_oat")

# Weight levels for the one-at-a-time sweep, as a percentage of the equal-weight
# baseline. 100 is absent deliberately: it IS the baseline, so including it would
# produce eleven bit-identical copies of it. 0 is present and means off — but see
# _swing_variants for why that has to become a disable rather than a 0 weight.
SWING_OAT_LEVELS: tuple[float, ...] = (0.0, 50.0, 200.0, 300.0)

# One composite configuration: (disabled members, weight overrides).
SwingVariant = tuple[tuple[str, ...], tuple[tuple[str, float], ...]]


def _swing_variants(spec: dict[str, Any], fixed: dict) -> list[SwingVariant]:
    """Every composite configuration to try, fully resolved and deduplicated.

    Resolved here rather than in ``_params_from`` so that duplicates can be seen
    and dropped. Two of them are guaranteed otherwise:

      * A 0% weight and a leave-one-out describe the SAME composite. 0% is not
        merely a small weight — a 0-weight member still counts toward the
        average's divisor and still has to have data at the bar, so "off" is a
        disable, not a weight. Ticking both modes would run eleven identical
        backtests.
      * The 100% level would repeat the baseline eleven times, which is why it
        isn't on the ladder.
    """
    base_w = {k: float(v) for k, v in (fixed.get("weightPct") or {}).items()}
    out: list[SwingVariant] = []
    seen: set[SwingVariant] = set()

    def add(disabled: set[str], weights: dict[str, float]) -> None:
        key: SwingVariant = (
            tuple(sorted(disabled)),
            tuple(sorted(weights.items())),
        )
        if key not in seen:
            seen.add(key)
            out.append(key)

    for name in spec.get("signalSubsets") or ["all"]:
        if name in SWING_SUBSETS:
            add(set(_SWING_ALL) - set(SWING_SUBSETS[name]), dict(base_w))
        elif name == "leave_one_out":
            for sig in _SWING_ALL:
                add({sig}, dict(base_w))
        elif name == "weight_oat":
            for sig in _SWING_ALL:
                for pct in SWING_OAT_LEVELS:
                    if pct == 0.0:
                        add({sig}, dict(base_w))
                    else:
                        add(set(), {**base_w, sig: pct})
    if not out:
        add(set(), dict(base_w))
    return out

# Modes that take no value — one combo each, whatever ladder is ticked.
_VALUELESS_SL = ("none", "structure")
_VALUELESS_TP = ("none", "resistance", "mean", "reversal")


def _exit_variants(
    modes: list[str], values: dict[str, list[float]], valueless: tuple[str, ...],
    default: float,
) -> list[tuple[str, float]]:
    """(mode, value) pairs for one exit axis, with valueless modes collapsed."""
    out: list[tuple[str, float]] = []
    for mode in modes:
        if mode in valueless:
            out.append((mode, default))
            continue
        picked = values.get(mode) or []
        # A value-taking mode with nothing ticked would silently vanish; fall
        # back to the current setting rather than dropping the user's choice.
        out.extend((mode, float(v)) for v in (picked or [default]))
    return out or [("none", default)]


def _indicator_variants(spec: dict[str, Any], fixed: dict) -> list[tuple[str, dict]]:
    """(kind, its own params) pairs — each indicator paired only with knobs it reads."""
    values = spec.get("indicatorValues") or {}
    out: list[tuple[str, dict]] = []
    for kind in spec.get("indicators") or ["ema"]:
        keys = _INDICATOR_PARAMS.get(kind, ())
        ladders = [
            [float(v) for v in (values.get(kind, {}).get(k) or [])]
            or [float(fixed.get(k, _INDICATOR_DEFAULTS.get(k, 0.0)))]
            for k in keys
        ]
        for combo in product(*ladders) if ladders else [()]:
            picked = dict(zip(keys, combo))
            # A fast EMA at or above the slow one isn't a cross, it's the inverse
            # signal wearing the same name — drop rather than silently score it.
            if kind == "ema" and picked.get("fast", 0) >= picked.get("slow", 1):
                continue
            out.append((kind, picked))
    return out or [("ema", {})]


def _held(spec: dict[str, Any], key: str, default: Any) -> Any:
    """The strategy's CURRENT value for a knob — what an unvaried axis holds at."""
    return (spec.get("baseline_params") or {}).get(key, default)


def _held_pv(spec: dict[str, Any], key: str, default: Any) -> Any:
    """Same, for knobs that live inside the explorer's ``paramValues`` blob."""
    pv = (spec.get("baseline_params") or {}).get("paramValues") or {}
    return pv.get(key, default)


def param_axes(spec: dict[str, Any]) -> dict[str, list]:
    """The per-combo knob axes (everything except coin and timeframe).

    Axes common to every scalp strategy are named directly; the ones that differ
    per strategy arrive under ``paramAxes`` and are prefixed ``pv:`` so they can
    be told apart when a combo is turned back into a parameter blob. Streak's own
    knobs predate that mechanism and keep their original spec keys, so the
    optimizations already recorded still expand identically.

    **No axis is ever empty.** An axis with nothing ticked means "hold this knob
    at the strategy's current setting", not "try none of its values" — the second
    reading makes the whole cartesian collapse to nothing, because a product with
    one empty factor is empty. That used to happen silently: the counter reports
    ``max(1, len(axis))`` per axis and so still promised thousands of combos while
    the expansion produced zero. Defaulting here is what keeps the count and the
    expansion two views of the same thing.
    """
    fixed = spec.get("fixed", {})
    axes: dict[str, list] = {
        "threshold": [float(v) for v in spec.get("threshold") or [_held(spec, "threshold", 3)]],
        "holdBars": [int(v) for v in spec.get("holdBars") or [_held(spec, "holdBars", 6)]],
        "side": list(spec.get("sides") or [_held(spec, "side", "both")]),
        "volGate": list(spec.get("volGate") or [_held(spec, "volGate", "off")]),
        "htfGate": list(spec.get("htfGate") or [_held(spec, "htfGate", "off")]),
        "sl": _exit_variants(
            list(spec.get("slModes") or [_held(spec, "slMode", "none")]), spec.get("slValues", {}),
            _VALUELESS_SL, float(fixed.get("slValue", 2.0)),
        ),
        "tp": _exit_variants(
            list(spec.get("tpModes") or [_held(spec, "tpMode", "none")]), spec.get("tpValues", {}),
            _VALUELESS_TP, float(fixed.get("tpValue", 3.0)),
        ),
    }
    if _is_streak(spec):
        axes["require_voldiv"] = [
            int(v) for v in spec.get("voldiv") or [_held_pv(spec, "require_voldiv", 0)]
        ]
        axes["btc_filter"] = [
            int(v) for v in spec.get("btcFilter") or [_held_pv(spec, "btc_filter", 0)]
        ]
    if spec.get("strategy") == "indicator":
        axes["ind"] = _indicator_variants(spec, fixed)
    if spec.get("strategy") == "swings":
        axes["subset"] = _swing_variants(spec, fixed)
    for key, values in (spec.get("paramAxes") or {}).items():
        if values:
            axes[f"pv:{key}"] = [float(v) for v in values]
    return axes


def _is_streak(spec: dict[str, Any]) -> bool:
    """Specs written before ``strategy`` was recorded are all streak — it was the
    only strategy the Optimize tab supported."""
    return spec.get("strategy", "streak") == "streak"


def count_param_combos(spec: dict[str, Any]) -> int:
    """Combos per (coin × timeframe) — what the dialog's counter multiplies."""
    n = 1
    for values in param_axes(spec).values():
        n *= max(1, len(values))
    return n


def cartesian_size(spec: dict[str, Any], n_coins: int, n_intervals: int) -> int:
    """The full grid before any sampling."""
    return max(0, n_coins) * max(0, n_intervals) * count_param_combos(spec)


def _params_from(axes_pick: dict, spec: dict[str, Any]) -> dict:
    """One combo as the explorer's own params blob — so a result can be applied
    straight back onto the page with no translation layer."""
    fixed = spec.get("fixed", {})
    sl_mode, sl_value = axes_pick["sl"]
    tp_mode, tp_value = axes_pick["tp"]
    # Only the knobs this strategy actually reads. Passing another strategy's
    # would be harmless to the backtest (they're ignored) but would show up in
    # the variation popup as settings that were never in play.
    param_values: dict[str, Any] = {}
    if _is_streak(spec):
        param_values["require_voldiv"] = axes_pick["require_voldiv"]
        param_values["btc_filter"] = axes_pick["btc_filter"]
    for key, value in axes_pick.items():
        if key.startswith("pv:"):
            param_values[key[3:]] = value
    indicator = str(fixed.get("indicator", "ema"))
    if "ind" in axes_pick:
        indicator, ind_params = axes_pick["ind"]
        param_values.update(ind_params)

    if spec.get("strategy") == "swings":
        # The swings explorer's own parameter shape — no vol gate, no indicator,
        # no paramValues; the composite is described by what is switched OFF and
        # how the rest are weighted, both resolved by _swing_variants.
        disabled, weights = axes_pick["subset"]
        return {
            "threshold": axes_pick["threshold"],
            "holdBars": axes_pick["holdBars"],
            "feeBps": float(fixed.get("feeBps", 8)),
            "side": axes_pick["side"],
            "slMode": sl_mode, "slValue": sl_value,
            "tpMode": tp_mode, "tpValue": tp_value,
            "htfGate": axes_pick["htfGate"],
            "htfTf": str(fixed.get("htfTf", "4h")),
            "htfLevel": float(fixed.get("htfLevel", 0.5)),
            "disabledSignals": list(disabled),
            "weightPct": dict(weights),
        }
    return {
        "threshold": axes_pick["threshold"],
        "holdBars": axes_pick["holdBars"],
        "feeBps": float(fixed.get("feeBps", 4)),
        "side": axes_pick["side"],
        "slMode": sl_mode,
        "slValue": sl_value,
        "tpMode": tp_mode,
        "tpValue": tp_value,
        "volGate": axes_pick["volGate"],
        "volLevel": float(fixed.get("volLevel", 1.0)),
        "htfGate": axes_pick["htfGate"],
        "htfTf": str(fixed.get("htfTf", "4h")),
        "htfLevel": float(fixed.get("htfLevel", 0.5)),
        # Only meaningful for the "indicator" strategy; kept so the blob
        # round-trips onto the explorer unchanged.
        "indicator": indicator,
        "paramValues": param_values,
    }


# Above this a NEW grid's sample is drawn with ``random.sample`` over the index
# range — uniform, and the range is never materialised, so a cartesian of
# billions costs the same as one of thousands. At or below it (and for every
# grid planned before the "draw" stamp existed, whatever its size) the sample
# is an index SHUFFLE instead, which reproduces the original
# materialise-shuffle-truncate draw exactly — see ``expand``. The largest
# cartesian on record is ~7k.
_MATERIALISE_LIMIT = 250_000


def _decode(index: int, radices: list[int]) -> list[int]:
    """Mixed-radix digits of ``index``, last radix varying fastest.

    This is the position ``itertools.product`` would have produced at that index,
    which is what lets a combo be drawn without building the ones before it.
    """
    out = [0] * len(radices)
    for i in range(len(radices) - 1, -1, -1):
        index, out[i] = divmod(index, radices[i])
    return out


def expand(
    spec: dict[str, Any],
    coins: list[tuple[str, str]],
    intervals: list[str],
    *,
    max_combos: int,
    seed: int,
    baseline_params: dict | None = None,
    only_market: tuple[str, str, str] | None = None,
) -> tuple[list[dict], int, bool]:
    """Every backtest to run: ``[{coin_id, quote_asset, interval, params, is_baseline}]``.

    ``coins`` are (coin_id, quote_asset) pairs. Returns the combos, the full
    cartesian size, and whether sampling kicked in. The BASELINE — the strategy's
    settings as they stand — is always included and never sampled away, so the
    search can always answer "did any of this beat what I already have".

    ``only_market`` keeps just one (coin, quote, interval)'s combos. The result is
    identical to expanding everything and filtering, but the discarded combos
    never have their parameter blob built — which is the whole cost. Every market
    child re-expands the grid to find its own share, so with a large budget that
    filter is the difference between seconds and minutes per child.
    """
    axes = param_axes(spec)
    keys = list(axes)
    per_combo = 1
    for k in keys:
        per_combo *= max(1, len(axes[k]))
    cartesian = max(0, len(coins)) * max(0, len(intervals)) * per_combo
    sampled = cartesian > max_combos

    def build(coin_i: int, iv_i: int, digits: Sequence[int]) -> dict | None:
        coin_id, quote = coins[coin_i]
        interval = intervals[iv_i]
        if only_market is not None and (coin_id, quote, interval) != only_market:
            return None
        pick = {k: axes[k][d] for k, d in zip(keys, digits)}
        return {
            "coin_id": coin_id,
            "quote_asset": quote,
            "interval": interval,
            "params": _params_from(pick, spec),
            "is_baseline": False,
        }

    combos: list[dict] = []
    if not sampled:
        # Full enumeration, streamed in product order — nothing to draw.
        picked: Iterable[tuple[int, int, Sequence[int]]] = (
            (ci, ii, digits)
            for ci, ii, digits in product(
                range(len(coins)), range(len(intervals)),
                product(*(range(len(axes[k])) for k in keys)),
            )
        )
    else:
        # Sampling draws INDICES into the cartesian and decodes only the
        # survivors — no combo tuple is ever built for a draw that lost, which
        # is what keeps a market child's re-expansion cheap.
        #
        # The draw must stay REPRODUCIBLE across code changes: children re-run
        # expand() to find their market's share (see tasks/strategy_optimization),
        # so a parent planned under one draw whose children run under another
        # would wait forever on combos nobody dispatched. The shuffle path
        # reproduces the original materialise-shuffle-truncate draw exactly —
        # Fisher-Yates depends only on the list length and the seed, so
        # shuffling the index range keeps the same positions the old code kept,
        # and decoding them yields the same combos in the same order.
        # ``random.sample`` (uniform, never materialises the range) is used only
        # for grids stamped ``draw`` >= 2 at plan time, i.e. grids that were
        # PLANNED by code that already drew that way.
        rng = random.Random(seed)
        if cartesian <= _MATERIALISE_LIMIT or int(spec.get("draw") or 1) < 2:
            idxs = list(range(cartesian))
            rng.shuffle(idxs)
            idxs = idxs[:max_combos]
        else:
            idxs = rng.sample(range(cartesian), max_combos)
        radices = [len(coins), len(intervals)] + [len(axes[k]) for k in keys]
        picked = (
            (digits[0], digits[1], digits[2:])
            for digits in (_decode(idx, radices) for idx in idxs)
        )

    for coin_i, iv_i, digits in picked:
        combo = build(coin_i, iv_i, digits)
        if combo is not None:
            combos.append(combo)

    if baseline_params:
        base_coin = spec.get("baseline", {})
        if base_coin.get("coin_id") and base_coin.get("interval"):
            base_market = (
                base_coin["coin_id"],
                base_coin.get("quote_asset", "USDT"),
                base_coin["interval"],
            )
            if only_market is None or base_market == only_market:
                combos.insert(0, {
                    "coin_id": base_market[0],
                    "quote_asset": base_market[1],
                    "interval": base_market[2],
                    "params": baseline_params,
                    "is_baseline": True,
                })
    return combos, cartesian, sampled


def group_by_market(combos: list[dict]) -> dict[tuple[str, str, str], list[dict]]:
    """Combos bucketed by (coin, quote, interval).

    The runner is coin-major for a reason: the kline load and feature
    computation dominate a single backtest and are shared by every combo on that
    market, while the context cache holds exactly one entry. Interleaving markets
    would rebuild it on every combo.
    """
    out: dict[tuple[str, str, str], list[dict]] = {}
    for c in combos:
        out.setdefault((c["coin_id"], c["quote_asset"], c["interval"]), []).append(c)
    return out
