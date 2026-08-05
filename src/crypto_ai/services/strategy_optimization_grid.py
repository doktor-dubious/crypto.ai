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


def param_axes(spec: dict[str, Any]) -> dict[str, list]:
    """The per-combo knob axes (everything except coin and timeframe).

    Axes common to every scalp strategy are named directly; the ones that differ
    per strategy arrive under ``paramAxes`` and are prefixed ``pv:`` so they can
    be told apart when a combo is turned back into a parameter blob. Streak's own
    knobs predate that mechanism and keep their original spec keys, so the
    optimizations already recorded still expand identically.
    """
    fixed = spec.get("fixed", {})
    axes: dict[str, list] = {
        "threshold": [float(v) for v in spec.get("threshold", [3])],
        "holdBars": [int(v) for v in spec.get("holdBars", [6])],
        "side": list(spec.get("sides", ["both"])),
        "volGate": list(spec.get("volGate", ["off"])),
        "htfGate": list(spec.get("htfGate", ["off"])),
        "sl": _exit_variants(
            list(spec.get("slModes", ["none"])), spec.get("slValues", {}),
            _VALUELESS_SL, float(fixed.get("slValue", 2.0)),
        ),
        "tp": _exit_variants(
            list(spec.get("tpModes", ["none"])), spec.get("tpValues", {}),
            _VALUELESS_TP, float(fixed.get("tpValue", 3.0)),
        ),
    }
    if _is_streak(spec):
        axes["require_voldiv"] = [int(v) for v in spec.get("voldiv", [0])]
        axes["btc_filter"] = [int(v) for v in spec.get("btcFilter", [0])]
    if spec.get("strategy") == "indicator":
        axes["ind"] = _indicator_variants(spec, fixed)
    if spec.get("strategy") == "swings":
        axes["subset"] = [
            name for name in (spec.get("signalSubsets") or ["all"]) if name in SWING_SUBSETS
        ] or ["all"]
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
        # no paramValues; the composite is described by what is switched OFF.
        enabled = set(SWING_SUBSETS[axes_pick["subset"]])
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
            "disabledSignals": sorted(set(_SWING_ALL) - enabled),
            "weightPct": dict(fixed.get("weightPct") or {}),
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


def expand(
    spec: dict[str, Any],
    coins: list[tuple[str, str]],
    intervals: list[str],
    *,
    max_combos: int,
    seed: int,
    baseline_params: dict | None = None,
) -> tuple[list[dict], int, bool]:
    """Every backtest to run: ``[{coin_id, quote_asset, interval, params, is_baseline}]``.

    ``coins`` are (coin_id, quote_asset) pairs. Returns the combos, the full
    cartesian size, and whether sampling kicked in. The BASELINE — the strategy's
    settings as they stand — is always included and never sampled away, so the
    search can always answer "did any of this beat what I already have".
    """
    axes = param_axes(spec)
    keys = list(axes)
    combos: list[dict] = []
    for (coin_id, quote), interval, values in product(
        coins, intervals, product(*(axes[k] for k in keys))
    ):
        pick = dict(zip(keys, values))
        combos.append({
            "coin_id": coin_id,
            "quote_asset": quote,
            "interval": interval,
            "params": _params_from(pick, spec),
            "is_baseline": False,
        })

    cartesian = len(combos)
    sampled = cartesian > max_combos
    if sampled:
        random.Random(seed).shuffle(combos)
        combos = combos[:max_combos]

    if baseline_params:
        base_coin = spec.get("baseline", {})
        if base_coin.get("coin_id") and base_coin.get("interval"):
            combos.insert(0, {
                "coin_id": base_coin["coin_id"],
                "quote_asset": base_coin.get("quote_asset", "USDT"),
                "interval": base_coin["interval"],
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
