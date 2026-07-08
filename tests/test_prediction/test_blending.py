"""Tests for orchestration blending: predictive sampling, economic-optimal
blending, dynamic reweighting, and the BlendingEngine wrapper."""

from datetime import date, timedelta

import numpy as np
import pytest

from crypto_ai.prediction.blending import (
    blend_predictions_dynamic_reweight,
    blend_predictions_predictive_sampling,
)
from crypto_ai.prediction.engine import QUANTILE_LEVELS
from crypto_ai.prediction.engines.blending import BlendingEngine
from crypto_ai.schemas.prediction import PredictionEngine as PredictionEngineEnum
from crypto_ai.schemas.prediction import PredictionResult

D0 = date(2026, 1, 1)


def _result(
    d: date,
    quantiles: list[float] | None = None,
    point: float | None = None,
    eo: float | None = None,
) -> PredictionResult:
    q = [float(v) for v in quantiles] if quantiles is not None else None
    pv = point if point is not None else (float(np.median(q)) if q else 0.0)
    return PredictionResult(
        date=d,
        predicted_value=pv,
        lower_bound=q[0] if q else pv,
        upper_bound=q[-1] if q else pv,
        economic_optimal=eo,
        quantiles=q,
    )


def _series(
    n_steps: int, quantiles: list[float] | None, point: float | None = None,
    eo: float | None = None,
) -> list[PredictionResult]:
    return [
        _result(D0 + timedelta(days=i), quantiles, point=point, eo=eo)
        for i in range(n_steps)
    ]


# ── Predictive sampling ─────────────────────────────────────────────────────


class TestPredictiveSampling:
    def test_single_engine_identity(self):
        """Blending one engine with weight 1 must return its own distribution."""
        q = list(np.linspace(50, 150, 9))
        out = blend_predictions_predictive_sampling(
            [_series(3, q)], {"a": 1.0}, ["a"]
        )
        assert len(out) == 3
        for step in out:
            np.testing.assert_allclose(step.quantiles, q, atol=0.3)
            assert step.lower_bound == pytest.approx(q[0], abs=0.3)
            assert step.upper_bound == pytest.approx(q[-1], abs=0.3)
            assert step.predicted_value == pytest.approx(100.0, abs=0.3)

    def test_equal_blend_median_between_engines(self):
        a = _series(2, list(np.linspace(80, 120, 9)))
        b = _series(2, list(np.linspace(180, 220, 9)))
        out = blend_predictions_predictive_sampling(
            [a, b], {"a": 0.5, "b": 0.5}, ["a", "b"]
        )
        # Median of a 50/50 bimodal mixture sits between the modes.
        assert 115 < out[0].predicted_value < 185
        # The band must span both modes, not shrink toward one of them.
        assert out[0].lower_bound < 121
        assert out[0].upper_bound > 179
        # Quantiles are monotonic by construction.
        assert out[0].quantiles == sorted(out[0].quantiles)

    def test_dominant_weight_follows_engine(self):
        a = _series(1, list(np.linspace(90, 110, 9)))
        b = _series(1, list(np.linspace(190, 210, 9)))
        out = blend_predictions_predictive_sampling(
            [a, b], {"a": 0.99, "b": 0.01}, ["a", "b"]
        )
        assert out[0].predicted_value == pytest.approx(100.0, abs=2.0)

    def test_economic_optimal_weighted(self):
        a = _series(1, list(np.linspace(90, 110, 9)), eo=10.0)
        b = _series(1, list(np.linspace(90, 110, 9)), eo=20.0)
        out = blend_predictions_predictive_sampling(
            [a, b], {"a": 0.25, "b": 0.75}, ["a", "b"]
        )
        assert out[0].economic_optimal == pytest.approx(17.5)

    def test_economic_optimal_partial_engines(self):
        """Only the engines that produced an EO participate (renormalized)."""
        a = _series(1, list(np.linspace(90, 110, 9)), eo=12.0)
        b = _series(1, list(np.linspace(90, 110, 9)), eo=None)
        out = blend_predictions_predictive_sampling(
            [a, b], {"a": 0.5, "b": 0.5}, ["a", "b"]
        )
        assert out[0].economic_optimal == pytest.approx(12.0)

    def test_economic_optimal_fallback_is_median(self):
        a = _series(1, list(np.linspace(90, 110, 9)))
        out = blend_predictions_predictive_sampling([a], {"a": 1.0}, ["a"])
        assert out[0].economic_optimal == pytest.approx(out[0].predicted_value)

    def test_point_only_engines_blend_as_point_masses(self):
        """Engines without quantiles contribute their point as a point mass;
        the blend median lands between them and the band spans the spread."""
        a = _series(1, None, point=10.0)
        b = _series(1, None, point=20.0)
        out = blend_predictions_predictive_sampling(
            [a, b], {"a": 0.5, "b": 0.5}, ["a", "b"]
        )
        assert out[0].predicted_value == pytest.approx(15.0, abs=0.5)
        assert out[0].lower_bound == pytest.approx(10.0, abs=0.5)
        assert out[0].upper_bound == pytest.approx(20.0, abs=0.5)

    def test_point_only_engine_weight_not_discarded(self):
        """A point-only engine mixed with a quantile engine must still pull
        the blend — its weight cannot silently vanish from the mixture."""
        a = _series(1, list(np.linspace(95, 105, 9)))
        b = _series(1, None, point=200.0)
        out = blend_predictions_predictive_sampling(
            [a, b], {"a": 0.5, "b": 0.5}, ["a", "b"]
        )
        assert out[0].predicted_value > 120
        assert out[0].upper_bound == pytest.approx(200.0, abs=1.0)

    def test_covers_longest_engine(self):
        a = _series(3, list(np.linspace(90, 110, 9)))
        b = _series(5, list(np.linspace(90, 110, 9)))
        out = blend_predictions_predictive_sampling(
            [a, b], {"a": 0.5, "b": 0.5}, ["a", "b"]
        )
        assert len(out) == 5

    def test_zero_weights_fall_back_to_equal(self):
        a = _series(1, list(np.linspace(90, 110, 9)))
        b = _series(1, list(np.linspace(190, 210, 9)))
        out = blend_predictions_predictive_sampling(
            [a, b], {"a": 0.0, "b": 0.0}, ["a", "b"]
        )
        assert 110 < out[0].predicted_value < 190

    def test_quantile_count_matches_levels(self):
        a = _series(1, list(np.linspace(90, 110, 9)))
        out = blend_predictions_predictive_sampling([a], {"a": 1.0}, ["a"])
        assert len(out[0].quantiles) == len(QUANTILE_LEVELS)


# ── Dynamic (Synapse-style) reweighting ─────────────────────────────────────


class TestDynamicReweight:
    def test_single_engine_matches_static(self):
        q = list(np.linspace(50, 150, 9))
        static = blend_predictions_predictive_sampling(
            [_series(5, q)], {"a": 1.0}, ["a"]
        )
        dynamic = blend_predictions_dynamic_reweight(
            [_series(5, q)], {"a": 1.0}, ["a"]
        )
        for s, d in zip(static, dynamic):
            assert d.predicted_value == pytest.approx(s.predicted_value)
            np.testing.assert_allclose(d.quantiles, s.quantiles)

    def test_first_step_uses_prior(self):
        a = _series(8, list(np.linspace(95, 105, 9)))
        b = _series(8, list(np.linspace(95, 105, 9)))
        c = _series(8, list(np.linspace(195, 205, 9)))
        w = {"a": 1 / 3, "b": 1 / 3, "c": 1 / 3}
        static = blend_predictions_predictive_sampling([a, b, c], w, ["a", "b", "c"])
        dynamic = blend_predictions_dynamic_reweight([a, b, c], w, ["a", "b", "c"])
        assert dynamic[0].predicted_value == pytest.approx(
            static[0].predicted_value, abs=0.5
        )

    def test_outlier_engine_is_downweighted(self):
        """Two engines agree near 100, one insists on 200: consensus-driven
        reweighting should pull later steps toward the consensus."""
        a = _series(8, list(np.linspace(95, 105, 9)))
        b = _series(8, list(np.linspace(95, 105, 9)))
        c = _series(8, list(np.linspace(195, 205, 9)))
        w = {"a": 1 / 3, "b": 1 / 3, "c": 1 / 3}
        static = blend_predictions_predictive_sampling([a, b, c], w, ["a", "b", "c"])
        dynamic = blend_predictions_dynamic_reweight([a, b, c], w, ["a", "b", "c"])
        assert dynamic[-1].predicted_value < static[-1].predicted_value
        assert dynamic[-1].predicted_value < dynamic[0].predicted_value

    def test_prior_strength_anchors(self):
        """A very strong prior should keep dynamic ≈ static."""
        a = _series(8, list(np.linspace(95, 105, 9)))
        c = _series(8, list(np.linspace(195, 205, 9)))
        w = {"a": 0.5, "c": 0.5}
        static = blend_predictions_predictive_sampling([a, c], w, ["a", "c"])
        anchored = blend_predictions_dynamic_reweight(
            [a, c], w, ["a", "c"], prior_strength=1e9
        )
        for s, d in zip(static, anchored):
            assert d.predicted_value == pytest.approx(s.predicted_value, abs=1.0)


# ── BlendingEngine wrapper ──────────────────────────────────────────────────


class FakeSubEngine:
    def __init__(self, quantiles: list[float] | None, fail: bool = False):
        self.quantiles = quantiles
        self.fail = fail
        self.allow_fallback = True

    async def predict_batch(self, items, horizon, prediction_from, batch_size=64):
        if self.fail:
            raise RuntimeError("boom")
        return [
            [
                _result(prediction_from + timedelta(days=i), self.quantiles)
                for i in range(horizon)
            ]
            for _ in items
        ]

    def apply_parameters(self, params):
        pass

    def get_capabilities(self):  # pragma: no cover - not exercised here
        raise NotImplementedError


class FakeRegistry:
    def __init__(self, engines: dict[str, FakeSubEngine]):
        self._engines = engines

    def get_engine(self, engine_type: PredictionEngineEnum) -> FakeSubEngine:
        return self._engines[engine_type.value]


SLUG_A = PredictionEngineEnum.TIMESFM.value
SLUG_B = PredictionEngineEnum.SUNDIAL.value


class TestBlendingEngine:
    async def test_failed_sub_engine_renormalizes_to_survivor(self):
        registry = FakeRegistry({
            SLUG_A: FakeSubEngine(list(np.linspace(90, 110, 9))),
            SLUG_B: FakeSubEngine(list(np.linspace(190, 210, 9)), fail=True),
        })
        engine = BlendingEngine(
            weights={SLUG_A: 0.5, SLUG_B: 0.5}, registry=registry
        )
        out = await engine.predict_batch(
            [{"historical_data": []}], horizon=3, prediction_from=D0
        )
        assert out[0][0].predicted_value == pytest.approx(100.0, abs=0.5)

    async def test_all_sub_engines_failed_raises(self):
        registry = FakeRegistry({
            SLUG_A: FakeSubEngine(None, fail=True),
            SLUG_B: FakeSubEngine(None, fail=True),
        })
        engine = BlendingEngine(
            weights={SLUG_A: 0.5, SLUG_B: 0.5}, registry=registry
        )
        with pytest.raises(RuntimeError):
            await engine.predict_batch(
                [{"historical_data": []}], horizon=3, prediction_from=D0
            )

    async def test_per_key_weights_override_default(self):
        registry = FakeRegistry({
            SLUG_A: FakeSubEngine(list(np.linspace(95, 105, 9))),
            SLUG_B: FakeSubEngine(list(np.linspace(195, 205, 9))),
        })
        engine = BlendingEngine(
            weights={SLUG_A: 0.5, SLUG_B: 0.5},
            weights_by_key={"BTC:USDT": {SLUG_A: 1.0}},
            registry=registry,
        )
        out = await engine.predict_batch(
            [
                {"historical_data": [], "_blend_key": "BTC:USDT"},
                {"historical_data": []},
            ],
            horizon=1,
            prediction_from=D0,
        )
        # Keyed item follows its per-key vector (engine A only)...
        assert out[0][0].predicted_value == pytest.approx(100.0, abs=0.5)
        # ...while the unkeyed item blends both with the default vector.
        assert 110 < out[1][0].predicted_value < 190

    async def test_apply_parameters_toggles_dynamic(self):
        registry = FakeRegistry({
            SLUG_A: FakeSubEngine(list(np.linspace(95, 105, 9))),
            SLUG_B: FakeSubEngine(list(np.linspace(195, 205, 9))),
        })
        engine = BlendingEngine(
            weights={SLUG_A: 0.5, SLUG_B: 0.5}, registry=registry
        )
        assert engine.dynamic_reweight is False
        engine.apply_parameters({"dynamic_reweight": "true", "prior_strength": "5"})
        assert engine.dynamic_reweight is True
        assert engine.prior_strength == 5.0
        out = await engine.predict_batch(
            [{"historical_data": []}], horizon=6, prediction_from=D0
        )
        assert len(out[0]) == 6
