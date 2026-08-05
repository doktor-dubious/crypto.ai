"""Tests for the higher-timeframe trend gate and its paired A/B reporting.

The no-lookahead test is the important one: the gate is the only signal in the
stack that reads a span long enough for an accidental forward-looking window to
go unnoticed while producing spectacular backtests.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import numpy as np
import pytest

from crypto_ai.services.paper_sweep import _gate_of, _gate_pairs, _without_gate
from crypto_ai.services.paper_trade_engine import _parse_knobs
from crypto_ai.services.swing_analysis import (
    apply_trend_gate,
    htf_lookback_bars,
    htf_min_bars,
    trend_strength,
)

BARS = 256  # a 15m scope gated on 4h


def _series(n: int = 3000, drift: float = 0.0002, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return 100 * np.exp(np.cumsum(rng.normal(drift, 0.005, n)))


# ── Lookback resolution ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("base", "htf", "expected"),
    [
        ("15m", "1h", 64),
        ("15m", "4h", 256),
        ("15m", "1d", 1536),
        ("1h", "4h", 64),
        ("1h", "15m", 0),  # not actually higher
        ("1h", "1h", 0),  # same timeframe
        ("4h", "6h", 0),  # less than 2x — not a meaningfully higher frame
    ],
)
def test_htf_lookback_bars(base: str, htf: str, expected: int) -> None:
    assert htf_lookback_bars(base, htf) == expected


# ── The gate itself ──────────────────────────────────────────────────────────


def test_trend_strength_signs_track_the_regime() -> None:
    """Up-drifting bars read positive, down-drifting bars negative."""
    rng = np.random.default_rng(0)
    n = 2000
    drift = np.concatenate([np.full(n // 2, 0.0008), np.full(n // 2, -0.0008)])
    c = 100 * np.exp(np.cumsum(drift + rng.normal(0, 0.004, n)))

    t = trend_strength(c, BARS)
    assert t[900] > 1.0
    assert t[1900] < -1.0
    # Warmup is NaN, and it is at least the lookback length.
    assert np.isnan(t[:BARS]).all()


def test_modes_partition_every_decided_bar() -> None:
    """align / counter / flat cover each other exactly: align and counter never
    both allow the same bar, and together with flat they cover every bar whose
    trend is defined. A gap would mean bars silently blocked by all modes."""
    c = _series()
    ctx = {"c": c}
    ones = np.ones(len(c))

    masks = {
        mode: apply_trend_gate(ctx, ones.copy(), ones.copy(), mode, BARS, 0.5)
        for mode in ("align", "counter", "flat")
    }
    long_ok = {m: np.isfinite(v[0]) for m, v in masks.items()}

    assert not (long_ok["align"] & long_ok["counter"]).any()
    decided = long_ok["align"] | long_ok["counter"] | long_ok["flat"]
    assert (decided == ~np.isnan(trend_strength(c, BARS))).all()


def test_off_and_inert_gate_are_no_ops() -> None:
    ctx = {"c": _series()}
    scores = np.arange(3000, dtype=float)

    for gate, bars in (("off", BARS), ("align", 0)):
        long_s, short_s = apply_trend_gate(
            ctx, scores.copy(), scores.copy(), gate, bars, 0.5
        )
        assert np.array_equal(long_s, scores)
        assert np.array_equal(short_s, scores)


def test_higher_level_is_strictly_more_selective() -> None:
    ctx = {"c": _series()}
    ones = np.ones(3000)

    allowed = []
    for level in (0.0, 0.5, 1.5):
        long_s, _ = apply_trend_gate(ctx, ones.copy(), ones.copy(), "align", BARS, level)
        allowed.append(int(np.isfinite(long_s).sum()))
    assert allowed[0] > allowed[1] > allowed[2]


def test_gate_has_no_lookahead() -> None:
    """Truncating the price series must not change a single earlier value.

    If the trend window ever reached forward, a shorter series would produce
    different (worse) values near its end than the full series does at the same
    bars — the classic way a filter like this fakes an edge.
    """
    c = _series()
    ctx_full = {"c": c}
    ones = np.ones(len(c))

    full = trend_strength(c, BARS)
    for cut in (1200, 2000, len(c) - 1):
        trunc = trend_strength(c[:cut], BARS)
        assert np.array_equal(np.isnan(full[:cut]), np.isnan(trunc))
        both = ~np.isnan(trunc)
        assert np.array_equal(full[:cut][both], trunc[both])

    # And through the gate, on the masks that actually drive entries.
    cut = 2000
    ctx_cut = {"c": c[:cut]}
    for mode in ("align", "flat", "counter"):
        lf, sf = apply_trend_gate(ctx_full, ones.copy(), ones.copy(), mode, BARS, 0.5)
        lt, st = apply_trend_gate(
            ctx_cut, ones[:cut].copy(), ones[:cut].copy(), mode, BARS, 0.5
        )
        assert np.array_equal(np.isnan(lf[:cut]), np.isnan(lt))
        assert np.array_equal(np.isnan(sf[:cut]), np.isnan(st))


# ── Knob parsing (what templates actually carry) ──────────────────────────────


def test_parse_knobs_resolves_the_lookback_from_the_run_interval() -> None:
    knobs = _parse_knobs(
        {"htfGate": "align", "htfTf": "4h", "htfLevel": 0.8}, "15m"
    )
    assert knobs["htf_gate"] == "align"
    assert knobs["htf_bars"] == 256
    assert knobs["htf_level"] == 0.8


def test_parse_knobs_disables_a_gate_that_is_not_actually_higher() -> None:
    """A 15m/4h template opened on a 1d scope must not silently gate on a
    LOWER timeframe — it goes inert instead."""
    knobs = _parse_knobs({"htfGate": "align", "htfTf": "4h"}, "1d")
    assert knobs["htf_gate"] == "off"
    assert knobs["htf_bars"] == 0


def test_parse_knobs_defaults_to_off() -> None:
    knobs = _parse_knobs({"threshold": 1.0}, "15m")
    assert knobs["htf_gate"] == "off"
    assert knobs["htf_bars"] == 0


def test_htf_min_bars_covers_both_windows() -> None:
    assert htf_min_bars(0) == 0
    assert htf_min_bars(BARS) == BARS + 200


# ── Paired A/B reporting ─────────────────────────────────────────────────────


def _run(template_id, name, params, coin, started, pnl_pct, trades=5):
    """A stand-in PaperTradeRun: the pairing only reads these attributes."""
    return SimpleNamespace(
        template_id=template_id,
        template_name=name,
        strategy="streak",
        params=params,
        scope={"coin_id": coin, "interval": "15m"},
        started_at=started,
        equity=100.0 * (1 + pnl_pct / 100.0),
        initial_capital=100.0,
        n_closed_trades=trades,
    )


def _pnl_pct(r) -> float:
    return (float(r.equity) - float(r.initial_capital)) / float(r.initial_capital) * 100.0


BASE_P = {"threshold": 1.0, "holdBars": 6}
GATED_P = {**BASE_P, "htfGate": "align", "htfTf": "4h", "htfLevel": 0.5}


def test_family_key_ignores_only_the_gate_knobs() -> None:
    assert _without_gate(BASE_P) == _without_gate(GATED_P)
    assert _without_gate(BASE_P) != _without_gate({**BASE_P, "holdBars": 8})
    assert _gate_of(BASE_P) is None
    assert _gate_of({**BASE_P, "htfGate": "off"}) is None
    assert _gate_of(GATED_P) == "align 4h (0.5σ)"


def test_gate_pairs_matches_on_coin_and_wave() -> None:
    wave = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
    by_template = {
        "base": [
            _run("base", "Streak", BASE_P, "btc", wave, 1.0),
            _run("base", "Streak", BASE_P, "eth", wave, -2.0),
            # A third coin the variant never ran on — must be ignored, not
            # silently compared against nothing.
            _run("base", "Streak", BASE_P, "sol", wave, 50.0),
        ],
        "gated": [
            _run("gated", "Streak · HTF", GATED_P, "btc", wave + timedelta(minutes=3), 3.0),
            _run("gated", "Streak · HTF", GATED_P, "eth", wave, -1.0),
        ],
    }

    pairs = _gate_pairs(by_template, _pnl_pct)
    assert len(pairs) == 1
    p = pairs[0]
    assert p.n_paired == 2  # sol dropped
    assert p.variant_gate == "align 4h (0.5σ)"
    assert p.delta_avg_pnl_pct == pytest.approx(1.5)  # (+2 and +1) / 2
    assert p.base_avg_pnl_pct == pytest.approx(-0.5)
    assert p.variant_avg_pnl_pct == pytest.approx(1.0)


def test_gate_pairs_needs_a_baseline_arm() -> None:
    """Gated templates with nothing to compare against report no pair rather
    than ranking against the rest of the leaderboard."""
    wave = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
    by_template = {
        "gated": [_run("gated", "Streak · HTF", GATED_P, "btc", wave, 3.0)],
    }
    assert _gate_pairs(by_template, _pnl_pct) == []


def test_gate_pairs_does_not_cross_different_strategies_or_knobs() -> None:
    wave = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
    by_template = {
        "base": [_run("base", "A", BASE_P, "btc", wave, 1.0)],
        # Same gate, but a different hold — a different family, so no pair.
        "gated_other": [
            _run("gated_other", "B", {**GATED_P, "holdBars": 12}, "btc", wave, 9.0)
        ],
    }
    assert _gate_pairs(by_template, _pnl_pct) == []


def test_gate_pairs_t_stat_reflects_consistency() -> None:
    """A small but CONSISTENT delta must out-rank a large erratic one — the
    whole point of reading the pair by t rather than by average."""
    base_wave = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
    rng = np.random.default_rng(3)
    consistent, erratic = [], []
    consistent_base, erratic_base = [], []
    for i in range(12):
        w = base_wave + timedelta(hours=i)
        coin = f"c{i}"
        consistent_base.append(_run("b1", "A", BASE_P, coin, w, 0.0))
        consistent.append(
            _run("g1", "A·HTF", GATED_P, coin, w, 0.4 + rng.normal(0, 0.05))
        )
        erratic_base.append(_run("b2", "B", {**BASE_P, "side": "x"}, coin, w, 0.0))
        erratic.append(
            _run("g2", "B·HTF", {**GATED_P, "side": "x"}, coin, w, 20.0 if i % 2 else -18.0)
        )

    pairs = _gate_pairs(
        {"b1": consistent_base, "g1": consistent, "b2": erratic_base, "g2": erratic},
        _pnl_pct,
    )
    assert len(pairs) == 2
    # Sorted by |t|: the consistent +0.4% wins despite the far smaller average.
    assert pairs[0].variant_template_id == "g1"
    assert pairs[0].delta_avg_pnl_pct < pairs[1].delta_avg_pnl_pct
    assert abs(pairs[0].delta_t) > abs(pairs[1].delta_t)
