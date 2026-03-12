"""AutoGluon Toto prediction engine."""

from gorm_ai.prediction.engine import EngineCapabilities
from gorm_ai.prediction.engines.autogluon_engine import AutoGluonEngine

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


class TotoEngine(AutoGluonEngine):
    """AutoGluon Toto zero-shot forecasting engine.

    Toto (Time-Series-Optimized Transformer for Observability) is a 151M parameter
    model from Datadog, trained on 1T+ data points. Packaged via AutoGluon.
    Requires a CUDA-compatible GPU; falls back to StatisticalEngine without one.
    """

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="AutoGluon Toto",
            description="Datadog Toto foundation model via AutoGluon (GPU required, zero-shot)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=4096,
            max_horizon=64,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def get_actual_slug(self) -> str | None:
        if not self._check_autogluon() or not _check_cuda():
            return "statistical"
        return None

    async def predict_batch(self, items, horizon, prediction_from, batch_size=64,
                            holding_rate=0.25, protection_days=7):
        if not self._check_autogluon() or not _check_cuda():
            from gorm_ai.prediction.engines.statistical import StatisticalEngine
            return await StatisticalEngine().predict_batch(
                items, horizon, prediction_from, batch_size
            )
        return await super().predict_batch(
            items, horizon, prediction_from, batch_size, holding_rate, protection_days
        )

    def _get_hyperparameters(self) -> dict:
        return {"Toto": {}}
