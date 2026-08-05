"""Tests for the BTC-beta filter on the streak strategy.

The filter decides whether a run of same-direction closes was the market
repricing the coin along with BTC (don't fade it) or the coin's own book
overreacting (fade it). Two things have to hold or the filter is worse than
useless: it must actually separate those two cases, and — like every other gate
in this stack — it must never read a bar that hasn't closed yet.
"""

from datetime import UTC, datetime, timedelta

import numpy as np

from crypto_ai.services.paper_trade_engine import _wants_btc_filter
from crypto_ai.services.swing_analysis import (
    BTC_FILTERS,
    SwingAnalysisService,
    apply_btc_beta_filter,
    bars_per_day,
    btc_driven_share,
)

HALFLIFE = 32


def _streaks(returns: np.ndarray) -> np.ndarray:
    """Signed run length ending at each bar (the ctx["streak"] convention)."""
    out = np.zeros(len(returns), dtype=np.int64)
    run = 0
    for i, r in enumerate(returns):
        run = (run + 1 if run > 0 else 1) if r > 0 else (run - 1 if run < 0 else -1) if r < 0 else 0
        out[i] = run
    return out


def _series(returns: np.ndarray, start: float = 100.0) -> np.ndarray:
    return start * np.exp(np.cumsum(returns))


def _ctx(c: np.ndarray, btc_c: np.ndarray) -> dict:
    r = np.zeros(len(c))
    r[1:] = np.diff(np.log(c))
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    return {
        "c": c,
        "btc_c": btc_c,
        "streak": _streaks(r),
        "times": np.array([t0 + timedelta(minutes=5 * i) for i in range(len(c))]),
    }


def test_btc_driven_run_is_recognised():
    """A coin that is a pure 1.5x of BTC: every run is BTC's, share ≈ 1."""
    rng = np.random.default_rng(7)
    rb = rng.normal(0, 0.004, 3000)
    r_alt = 1.5 * rb
    share = btc_driven_share(_series(r_alt), _series(rb), _streaks(r_alt), HALFLIFE)
    warm = share[500:]
    warm = warm[np.isfinite(warm)]
    assert len(warm) > 1000
    assert np.median(warm) > 0.9


def test_idiosyncratic_run_is_recognised():
    """BTC flat, the coin moving on its own: share ≈ 0."""
    rng = np.random.default_rng(11)
    r_alt = rng.normal(0, 0.004, 3000)
    rb = rng.normal(0, 0.0001, 3000)  # BTC essentially still
    share = btc_driven_share(_series(r_alt), _series(rb), _streaks(r_alt), HALFLIFE)
    warm = share[500:]
    warm = warm[np.isfinite(warm)]
    assert len(warm) > 1000
    assert abs(np.median(warm)) < 0.2


def test_filter_modes_are_complementary():
    """idio and btc keep disjoint entries, and together they keep every decided
    bar — otherwise the split is dropping trades it never classified."""
    rng = np.random.default_rng(3)
    rb = rng.normal(0, 0.004, 4000)
    r_alt = 0.8 * rb + rng.normal(0, 0.004, 4000)  # both components present
    ctx = _ctx(_series(r_alt), _series(rb))
    long_s = np.where(ctx["streak"] < 0, -ctx["streak"].astype(float), np.nan)
    short_s = np.where(ctx["streak"] > 0, ctx["streak"].astype(float), np.nan)

    off_l, _ = apply_btc_beta_filter(ctx, long_s, short_s, "off")
    idio_l, idio_s = apply_btc_beta_filter(ctx, long_s, short_s, "idio")
    btc_l, btc_s = apply_btc_beta_filter(ctx, long_s, short_s, "btc")

    assert np.array_equal(np.isnan(off_l), np.isnan(long_s))  # off is a no-op
    kept_idio = np.isfinite(idio_l) | np.isfinite(idio_s)
    kept_btc = np.isfinite(btc_l) | np.isfinite(btc_s)
    assert not (kept_idio & kept_btc).any()  # disjoint
    assert kept_idio.sum() > 100 and kept_btc.sum() > 100  # both actually fire
    # Every kept bar was a real entry in the unfiltered strategy.
    entries = np.isfinite(long_s) | np.isfinite(short_s)
    assert (kept_idio | kept_btc)[~entries].sum() == 0


def test_missing_btc_series_is_a_noop():
    """No BTC context (e.g. the run's coin IS BTC) must not silently block."""
    rng = np.random.default_rng(5)
    r_alt = rng.normal(0, 0.004, 500)
    ctx = _ctx(_series(r_alt), np.full(500, np.nan))
    ctx["btc_c"] = None
    long_s = np.ones(500)
    out_l, out_s = apply_btc_beta_filter(ctx, long_s, long_s, "idio")
    assert np.array_equal(out_l, long_s) and np.array_equal(out_s, long_s)


def test_gaps_in_btc_block_rather_than_mispair():
    """A run whose bars BTC didn't trade gets no verdict, not a wrong one."""
    rng = np.random.default_rng(13)
    rb = rng.normal(0, 0.004, 1500)
    r_alt = 1.2 * rb
    btc_c = _series(rb)
    btc_c[1000:1100] = np.nan  # ingest hole
    share = btc_driven_share(_series(r_alt), btc_c, _streaks(r_alt), HALFLIFE)
    assert np.all(np.isnan(share[1001:1100]))


def test_no_lookahead():
    """Truncating the future must not change any past bar's verdict."""
    rng = np.random.default_rng(17)
    rb = rng.normal(0, 0.004, 2000)
    r_alt = 0.9 * rb + rng.normal(0, 0.003, 2000)
    c, bc, st = _series(r_alt), _series(rb), _streaks(r_alt)

    full = btc_driven_share(c, bc, st, HALFLIFE)
    cut = 1500
    truncated = btc_driven_share(c[:cut], bc[:cut], st[:cut], HALFLIFE)
    a, b = full[:cut], truncated
    both = np.isfinite(a) & np.isfinite(b)
    assert both.sum() > 500
    assert np.allclose(a[both], b[both])
    assert np.array_equal(np.isnan(a), np.isnan(b))


def test_alignment_is_by_timestamp_not_position():
    """BTC rows with a missing bar must not shift onto the wrong stamps."""
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    times = [t0 + timedelta(minutes=5 * i) for i in range(6)]
    rows = [
        (t, 10.0, 11.0, 9.0, 10.0 + i, 100.0, 5, 50.0)
        for i, t in enumerate(times)
    ]
    btc_rows = [(t, 1000.0 + i) for i, t in enumerate(times) if i != 3]  # hole at 3
    ctx = SwingAnalysisService._compute_context(rows, t0, btc_rows)
    btc_c = ctx["btc_c"]
    assert np.isnan(btc_c[3])
    assert btc_c[4] == 1004.0  # NOT 1003.0, which is what zipping would give


def test_bars_per_day_infers_interval():
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    five_min = np.array([t0 + timedelta(minutes=5 * i) for i in range(50)])
    hourly = np.array([t0 + timedelta(hours=i) for i in range(50)])
    assert bars_per_day(five_min) == 288
    assert bars_per_day(hourly) == 24


def test_engine_only_fetches_btc_when_the_filter_is_on():
    base = {"param_values": {}}
    assert not _wants_btc_filter("streak", base)
    assert not _wants_btc_filter("streak", {"param_values": {"btc_filter": 0}})
    assert _wants_btc_filter("streak", {"param_values": {"btc_filter": 1}})
    assert _wants_btc_filter("streak", {"param_values": {"btc_filter": 2}})
    # Other strategies never pay for the extra fetch.
    assert not _wants_btc_filter("range", {"param_values": {"btc_filter": 1}})
    # A garbage value must not crash the tick.
    assert not _wants_btc_filter("streak", {"param_values": {"btc_filter": "yes"}})


def test_filter_names_match_the_numeric_encoding():
    """The UI sends 0/1/2; BTC_FILTERS is what those index into."""
    assert BTC_FILTERS == ("off", "idio", "btc")
