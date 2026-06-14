"""AutoGluon Chronos-2 prediction engine."""

from crypto_ai.prediction.engine import EngineCapabilities
from crypto_ai.prediction.engines.autogluon_engine import AutoGluonEngine


class Chronos2Engine(AutoGluonEngine):
    """AutoGluon Chronos-2 zero-shot forecasting engine.

    Chronos-2 is Amazon's foundation model for time series, packaged via AutoGluon.
    It natively supports covariates (unlike Chronos-Bolt / original Chronos), making
    it well-suited for outlets with financial and PAD event features.
    """

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="AutoGluon Chronos-2",
            description="Amazon Chronos-2 foundation model with native covariate support",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=8192,
            max_horizon=64,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def _get_hyperparameters(self) -> dict:
        return {"Chronos2": {}}
