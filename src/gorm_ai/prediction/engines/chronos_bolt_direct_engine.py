"""Direct Chronos-Bolt prediction engine (no AutoGluon wrapper).

Subclasses Chronos2DirectEngine with the Bolt model ID.  Chronos-Bolt is
faster than Chronos 2.0 because it outputs quantiles directly instead of
drawing sample paths.
"""

from gorm_ai.prediction.engine import EngineCapabilities
from gorm_ai.prediction.engines.chronos2_direct_engine import Chronos2DirectEngine


class ChronosBoltDirectEngine(Chronos2DirectEngine):
    """Direct Chronos-Bolt engine — load once, predict many.

    Identical to Chronos2DirectEngine but defaults to the Bolt model which
    produces quantiles natively (no sampling), making it faster and more
    memory-efficient.
    """

    def __init__(self):
        super().__init__(model_id="amazon/chronos-bolt-base")

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Chronos-Bolt",
            description="Amazon Chronos-Bolt foundation model (direct, no AutoGluon)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=2048,
            max_horizon=64,
            supported_frequencies=["daily", "weekly", "monthly"],
        )
