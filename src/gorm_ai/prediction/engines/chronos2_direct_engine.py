"""Direct Chronos 2.0 prediction engine (no AutoGluon wrapper).

Loads the Chronos model once via the chronos-forecasting library and reuses it
across all prediction calls, avoiding the per-batch model reload that the
AutoGluon-based engine suffers from.
"""

from gorm_ai.prediction.engine import EngineCapabilities
from gorm_ai.prediction.engines.chronos_pipeline_engine import (
    BATCH_SIZE,
    ChronosPipelineEngine,
)

DEFAULT_MODEL_ID = "amazon/chronos-t5-small"


class Chronos2DirectEngine(ChronosPipelineEngine):
    """Direct Chronos 2.0 engine — load once, predict many.

    Uses the ``chronos-forecasting`` library directly instead of AutoGluon's
    ``TimeSeriesPredictor``.  The model is loaded lazily on first prediction and
    cached on the instance for the lifetime of the Celery worker process.
    """

    _MODEL_ALIASES: dict[str, str] = {
        "chronos-t5-tiny": "amazon/chronos-t5-tiny",
        "chronos-t5-mini": "amazon/chronos-t5-mini",
        "chronos-t5-small": "amazon/chronos-t5-small",
        "chronos-t5-base": "amazon/chronos-t5-base",
        "chronos-t5-large": "amazon/chronos-t5-large",
        "chronos-bolt-tiny": "amazon/chronos-bolt-tiny",
        "chronos-bolt-mini": "amazon/chronos-bolt-mini",
        "chronos-bolt-small": "amazon/chronos-bolt-small",
        "chronos-bolt-base": "amazon/chronos-bolt-base",
    }
    _DEFAULT_PREFIX = "amazon/"

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        super().__init__(model_id=model_id, default_precision="bfloat16")

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Chronos 2.0",
            description="Amazon Chronos 2.0 foundation model (direct, no AutoGluon)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=2048,
            max_horizon=64,
            supported_frequencies=["daily", "weekly", "monthly"],
        )
