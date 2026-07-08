"""Ensemble blending engine for model orchestration.

Runs several sub-engines over a batch and blends each series' forecasts with a
weight vector. Weights can vary per series: each batch item may carry a
``_blend_key`` (e.g. outlet id or product key); the engine looks that key up in
``weights_by_key`` and falls back to the group-level ``weights`` when absent.
"""

import logging
from datetime import date

from crypto_ai.prediction.blending import (
    blend_predictions_dynamic_reweight,
    blend_predictions_predictive_sampling,
)
from crypto_ai.prediction.engine import EngineCapabilities, PredictionEngine
from crypto_ai.schemas.prediction import PredictionEngine as PredictionEngineEnum
from crypto_ai.schemas.prediction import PredictionResult

logger = logging.getLogger(__name__)


class BlendingEngine(PredictionEngine):
    """Weighted ensemble of sub-engines with optional per-series weights."""

    def __init__(
        self,
        weights: dict[str, float],
        weights_by_key: dict[str, dict[str, float]] | None = None,
        allow_fallback: bool = True,
        registry=None,
        engine_params: dict[str, dict[str, str]] | None = None,
        dynamic_reweight: bool = False,
        prior_strength: float = 3.0,
    ) -> None:
        self.allow_fallback = allow_fallback
        # Synapse-style per-step adaptive arbitration (opt-in; see
        # blend_predictions_dynamic_reweight). Calibrated weights act as prior.
        self.dynamic_reweight = dynamic_reweight
        self.prior_strength = prior_strength
        self.weights = self._normalize(weights)
        self.weights_by_key = {
            k: self._normalize(v) for k, v in (weights_by_key or {}).items()
        }
        engine_params = engine_params or {}

        # Union of every slug referenced by the default or any per-key vector.
        slugs: set[str] = set(self.weights)
        for vec in self.weights_by_key.values():
            slugs |= set(vec)

        if registry is None:
            from crypto_ai.prediction.registry import EngineRegistry
            registry = EngineRegistry()

        self._engines: dict[str, PredictionEngine] = {}
        for slug in sorted(slugs):
            try:
                engine = registry.get_engine(PredictionEngineEnum(slug))
                engine.allow_fallback = allow_fallback
                # Apply this model's stored parameter overrides (model size, etc.).
                if engine_params.get(slug):
                    engine.apply_parameters(engine_params[slug])
                self._engines[slug] = engine
            except Exception as e:
                logger.warning("BlendingEngine: could not resolve engine '%s': %s", slug, e)
        self._slugs = list(self._engines.keys())
        if not self._slugs:
            raise ValueError("BlendingEngine has no resolvable sub-engines")

    @staticmethod
    def _normalize(vec: dict[str, float]) -> dict[str, float]:
        total = sum(vec.values())
        return {s: w / total for s, w in vec.items()} if total > 0 else dict(vec)

    async def predict_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from: date,
        batch_size: int = 64,
    ) -> list[list[PredictionResult]]:
        # Run every sub-engine over the whole batch once.
        per_engine: dict[str, list[list[PredictionResult]]] = {}
        for slug in self._slugs:
            try:
                per_engine[slug] = await self._engines[slug].predict_batch(
                    items, horizon=horizon, prediction_from=prediction_from,
                    batch_size=batch_size,
                )
            except Exception as e:
                logger.warning("BlendingEngine: sub-engine '%s' failed: %s", slug, e)
        live = [s for s in self._slugs if s in per_engine]
        if not live:
            raise RuntimeError("BlendingEngine: all sub-engines failed")

        results: list[list[PredictionResult]] = []
        for i, item in enumerate(items):
            key = item.get("_blend_key")
            base_w = self.weights_by_key.get(key, self.weights)

            preds_by_engine: list[list[PredictionResult]] = []
            slugs_for_item: list[str] = []
            for slug in live:
                engine_out = per_engine[slug]
                res_i = engine_out[i] if i < len(engine_out) else None
                if res_i:
                    preds_by_engine.append(res_i)
                    slugs_for_item.append(slug)

            if not preds_by_engine:
                results.append([])
                continue

            # Restrict + renormalize weights to the engines that produced output.
            w = self._normalize({s: base_w.get(s, 0.0) for s in slugs_for_item})
            if sum(w.values()) <= 0:  # key had no overlap with live engines
                w = self._normalize({s: 1.0 for s in slugs_for_item})

            if self.dynamic_reweight:
                results.append(
                    blend_predictions_dynamic_reweight(
                        preds_by_engine, w, slugs_for_item,
                        prior_strength=self.prior_strength,
                    )
                )
            else:
                results.append(
                    blend_predictions_predictive_sampling(
                        preds_by_engine, w, slugs_for_item
                    )
                )
        return results

    async def predict(
        self,
        historical_data: list[dict],
        horizon: int,
        prediction_from: date,
        covariates: dict | None = None,
        pad_dates: dict | None = None,
        **kwargs,
    ) -> list[PredictionResult]:
        item: dict = {
            "historical_data": historical_data,
            "covariates": covariates,
            "pad_dates": pad_dates,
        }
        if "_blend_key" in kwargs:
            item["_blend_key"] = kwargs["_blend_key"]
        out = await self.predict_batch(
            [item], horizon=horizon, prediction_from=prediction_from
        )
        return out[0] if out else []

    def get_capabilities(self) -> EngineCapabilities:
        caps = [e.get_capabilities() for e in self._engines.values()]
        if not caps:
            return EngineCapabilities(
                name="blending", description="Ensemble blend",
                min_history_length=7, max_horizon=365,
            )
        max_hist = [c.max_history_length for c in caps if c.max_history_length]
        return EngineCapabilities(
            name="blending",
            description="Ensemble blend of " + ", ".join(self._slugs),
            supports_uncertainty=True,
            # Most restrictive bounds across sub-engines so every one can run.
            min_history_length=max(c.min_history_length for c in caps),
            max_history_length=min(max_hist) if max_hist else None,
            max_horizon=min(c.max_horizon for c in caps),
            optimal_horizon=max(c.optimal_horizon for c in caps),
        )

    def apply_parameters(self, params: dict[str, str]) -> None:
        """Blend-level runtime parameters (strategy engine-params for slug
        ``blending``): ``dynamic_reweight`` ("true"/"false") toggles Synapse-style
        per-step adaptive arbitration; ``prior_strength`` (float) sets how many
        steps of simulated evidence it takes to match the calibrated prior."""
        if "dynamic_reweight" in params:
            self.dynamic_reweight = str(params["dynamic_reweight"]).strip().lower() in (
                "true", "1", "yes", "on",
            )
        if "prior_strength" in params:
            try:
                self.prior_strength = max(0.0, float(params["prior_strength"]))
            except (TypeError, ValueError):
                logger.warning(
                    "BlendingEngine: invalid prior_strength %r ignored",
                    params["prior_strength"],
                )

    def get_actual_slug(self) -> str:
        return "blending"
