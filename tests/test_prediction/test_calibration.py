"""Tests for calibration metrics, origin construction, and the
common-fold / top-N aggregation in combine_engine_scores."""

import math

import numpy as np
import pytest

from crypto_ai.services.calibration import CalibrationService, _season_for
from crypto_ai.services.orchestration import OrchestrationService


@pytest.fixture
def cal() -> CalibrationService:
    return CalibrationService(session=None)


@pytest.fixture
def orch() -> OrchestrationService:
    return OrchestrationService(session=None)


# ── Metrics ─────────────────────────────────────────────────────────────────


class TestMetrics:
    def test_mase_scales_by_lag1_naive(self, cal):
        actual = np.array([10.0, 12.0, 11.0])
        predicted = np.array([10.0, 12.0, 11.0])
        train = np.array([10.0, 12.0, 10.0, 12.0])
        assert cal._compute_metric(actual, predicted, "mase", train) == 0.0

    def test_smase_uses_seasonal_denominator(self, cal):
        """On a perfectly weekly-seasonal training series the lag-7 naive error
        is ~0 while the lag-1 error is large — smase must be much larger than
        mase for the same forecast errors."""
        week = np.array([100.0, 20.0, 30.0, 40.0, 50.0, 60.0, 120.0])
        train = np.tile(week, 8)  # 56 steps, perfectly seasonal
        actual = week.copy()
        predicted = actual + 5.0
        mase = cal._compute_metric(actual, predicted, "mase", train, season=7)
        smase = cal._compute_metric(actual, predicted, "smase", train, season=7)
        assert smase > mase * 100

    def test_smase_falls_back_to_lag1_when_short(self, cal):
        train = np.array([10.0, 12.0, 11.0])  # shorter than the season
        actual = np.array([10.0, 12.0])
        predicted = np.array([11.0, 11.0])
        mase = cal._compute_metric(actual, predicted, "mase", train, season=7)
        smase = cal._compute_metric(actual, predicted, "smase", train, season=7)
        assert smase == pytest.approx(mase)

    def test_crps_perfect_quantiles_zero(self, cal):
        actual = np.array([10.0, 20.0])
        quantiles = np.array([[10.0] * 9, [20.0] * 9])
        crps = cal._compute_metric(actual, actual.copy(), "crps", quantiles=quantiles)
        assert crps == pytest.approx(0.0)

    def test_crps_prefers_calibrated_distribution(self, cal):
        """A quantile spread that covers the actual scores better than a
        misplaced one."""
        actual = np.array([100.0])
        good = np.linspace(90, 110, 9).reshape(1, -1)
        bad = np.linspace(140, 160, 9).reshape(1, -1)
        pred = np.array([100.0])
        crps_good = cal._compute_metric(actual, pred, "crps", quantiles=good)
        crps_bad = cal._compute_metric(actual, pred, "crps", quantiles=bad)
        assert crps_good < crps_bad

    def test_crps_point_fallback(self, cal):
        """Without quantiles, CRPS degrades to pinball of a flat quantile
        function: 2 · 0.5|e| / mean|y|."""
        actual = np.array([100.0])
        pred = np.array([90.0])
        crps = cal._compute_metric(actual, pred, "crps", quantiles=None)
        assert crps == pytest.approx(2 * 0.5 * 10.0 / 100.0)

    def test_crps_zero_actuals_is_inf(self, cal):
        actual = np.zeros(3)
        pred = np.ones(3)
        assert math.isinf(cal._compute_metric(actual, pred, "crps"))

    def test_season_for(self):
        # Crypto seasons are keyed by kline interval (bars per dominant cycle).
        assert _season_for("1h") == 24    # hourly → one day
        assert _season_for("1d") == 7     # daily → one week
        assert _season_for("1w") == 1
        assert _season_for("nope") == 1   # unknown interval → plain naive


# ── Origins ─────────────────────────────────────────────────────────────────


class TestOrigins:
    def test_origins_non_overlapping_and_ordered(self, cal):
        origins = cal._build_origins(n=70, horizon=7, max_origins=6, min_train=28)
        assert len(origins) == 6
        for train_end, test_end in origins:
            assert test_end - train_end == 7
            assert train_end >= 28
        # Chronological and non-overlapping.
        for (_, prev_end), (next_start, _) in zip(origins, origins[1:]):
            assert next_start == prev_end

    def test_origins_insufficient_data(self, cal):
        assert cal._build_origins(n=30, horizon=7, max_origins=6, min_train=28) == []


# ── combine_engine_scores: common folds + top-N membership ─────────────────


class TestCombineEngineScores:
    def test_common_fold_average(self, orch):
        """Engine B fails the hard fold f2 — both engines must be compared on
        the common fold f1 only, where they are equal."""
        scores = {
            "a": {"k": {"0:0": 1.0, "0:1": 10.0}},
            "b": {"k": {"0:0": 1.0}},
        }
        composition, by_key = orch.combine_engine_scores("pair", scores, top_n=2)
        assert composition["a"] == pytest.approx(0.5, abs=1e-6)
        assert composition["b"] == pytest.approx(0.5, abs=1e-6)

    def test_disjoint_folds_fall_back_to_own_average(self, orch):
        scores = {
            "a": {"k": {"0:0": 1.0}},
            "b": {"k": {"0:1": 3.0}},
        }
        composition, _ = orch.combine_engine_scores("pair", scores, top_n=2)
        assert composition["a"] > composition["b"]

    def test_legacy_scalar_scores_accepted(self, orch):
        scores = {"a": {"k": 1.0}, "b": {"k": 3.0}}
        composition, _ = orch.combine_engine_scores("pair", scores, top_n=2)
        assert composition["a"] > composition["b"]
        assert sum(composition.values()) == pytest.approx(1.0)

    def test_top_n_membership_is_global(self, orch):
        """With top_n=2, the composition and every per-key vector must be
        restricted to the same two best engines."""
        scores = {
            "a": {"k1": {"0:0": 1.0}, "k2": {"0:0": 1.0}},
            "b": {"k1": {"0:0": 2.0}, "k2": {"0:0": 2.0}},
            "c": {"k1": {"0:0": 8.0}, "k2": {"0:0": 4.0}},
            "d": {"k1": {"0:0": 9.0}, "k2": {"0:0": 9.0}},
        }
        composition, by_key = orch.combine_engine_scores("pair", scores, top_n=2)
        assert set(composition) == {"a", "b"}
        for vec in by_key.values():
            assert set(vec) <= {"a", "b"}
            assert sum(vec.values()) == pytest.approx(1.0)

    def test_pooled_grain(self, orch):
        scores = {
            "a": {"__pooled__": {"0:0": 1.0, "1:0": 1.0}},
            "b": {"__pooled__": {"0:0": 2.0, "1:0": 2.0}},
            "c": {"__pooled__": {"0:0": 4.0, "1:0": 4.0}},
        }
        composition, by_key = orch.combine_engine_scores("pooled", scores, top_n=2)
        assert by_key == {}
        assert set(composition) == {"a", "b"}
        assert composition["a"] > composition["b"]

    def test_engine_with_no_folds_gets_zero_weight(self, orch):
        scores = {
            "a": {"k": {"0:0": 1.0}},
            "b": {"k": {}},
        }
        composition, _ = orch.combine_engine_scores("pair", scores, top_n=2)
        assert composition.get("b", 0.0) == 0.0
        assert composition["a"] == pytest.approx(1.0)

    def test_no_scores_raises(self, orch):
        with pytest.raises(ValueError):
            orch.combine_engine_scores("pair", {"a": {}}, top_n=2)

    def test_inverse_error_ordering(self, orch):
        """Lower error → strictly more weight, and weights normalize to 1."""
        scores = {
            "a": {"k": {"0:0": 0.5}},
            "b": {"k": {"0:0": 1.0}},
            "c": {"k": {"0:0": 2.0}},
        }
        composition, _ = orch.combine_engine_scores("pair", scores, top_n=3)
        assert composition["a"] > composition["b"] > composition["c"]
        assert sum(composition.values()) == pytest.approx(1.0)
