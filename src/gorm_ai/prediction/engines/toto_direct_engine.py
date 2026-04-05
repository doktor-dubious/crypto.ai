"""Direct Toto prediction engine (no AutoGluon wrapper).

Loads the Datadog Toto model once via the chronos-forecasting library and
reuses it across all prediction calls.  Toto is a 151M parameter foundation
model trained on 1T+ data points from Datadog's observability platform.

Requires a CUDA-compatible GPU; falls back to StatisticalEngine without one.
"""

import logging

from gorm_ai.prediction.engine import EngineCapabilities
from gorm_ai.prediction.engines.chronos_pipeline_engine import (
    BATCH_SIZE,
    ChronosPipelineEngine,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "Datadog/Toto-Open-Base-1.0"

_CUDA_AVAILABLE: bool | None = None


def _check_cuda() -> bool:
    global _CUDA_AVAILABLE
    if _CUDA_AVAILABLE is None:
        try:
            import torch

            _CUDA_AVAILABLE = torch.cuda.is_available()
        except ImportError:
            _CUDA_AVAILABLE = False
    return _CUDA_AVAILABLE


class TotoDirectEngine(ChronosPipelineEngine):
    """Direct Toto engine — load once, predict many.

    Datadog Toto (Time-Series-Optimized Transformer for Observability) is a
    151M parameter model trained on 1T+ data points.  Uses the
    chronos-forecasting library directly instead of AutoGluon's
    TimeSeriesPredictor, avoiding per-batch model reload overhead.

    Toto produces sample paths (like Chronos T5 models), which are aggregated
    into P10–P90 quantile forecasts.

    Requires CUDA; falls back to StatisticalEngine on CPU-only machines.
    """

    _MODEL_ALIASES: dict[str, str] = {
        "toto-open-base": "Datadog/Toto-Open-Base-1.0",
        "toto-open-base-1.0": "Datadog/Toto-Open-Base-1.0",
    }
    _DEFAULT_PREFIX = "Datadog/"

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        super().__init__(model_id=model_id, default_precision="bfloat16")

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Toto",
            description="Datadog Toto foundation model (direct, GPU required)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=4096,
            max_horizon=720,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def get_actual_slug(self) -> str | None:
        if not _check_cuda():
            return "statistical"
        if self._model_loaded and self._pipeline is None:
            return "statistical"
        return None

    async def predict_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from,
        batch_size: int = BATCH_SIZE,
        holding_rate: float = 0.25,
        protection_days: int = 7,
    ) -> list[list]:
        if not _check_cuda():
            if not self.allow_fallback:
                raise RuntimeError("Toto requires CUDA and engine fallback is disabled")
            from gorm_ai.prediction.engines.statistical import StatisticalEngine

            logger.warning("Toto requires CUDA; falling back to StatisticalEngine")
            return await StatisticalEngine().predict_batch(
                items, horizon, prediction_from, batch_size
            )
        return await super().predict_batch(
            items, horizon, prediction_from, batch_size,
            holding_rate, protection_days,
        )
