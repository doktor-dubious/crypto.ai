"""Abstract base class for prediction engines."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date

import numpy as np

from gorm_ai.schemas.prediction import PredictionResult

# Quantile levels produced by all engines (P10–P90).
QUANTILE_LEVELS = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])


def interpolate_quantile(tau: float, quantile_values: np.ndarray) -> float:
    """Interpolate the forecast distribution at critical fractile *tau*.

    Within the P10–P90 range this is plain linear interpolation.  Beyond P90
    (high-margin or high-CV products) the Q80→Q90 slope is extrapolated
    linearly, capped at Q90 + 2×(Q90 − Q80) — roughly a P99 proxy for a
    normal distribution — to avoid runaway values in the tail.

    Args:
        tau: Newsvendor critical fractile, typically in (0, 1).
        quantile_values: Array of quantile forecasts aligned with
            ``QUANTILE_LEVELS`` (length 9, P10–P90).
    """
    if tau <= QUANTILE_LEVELS[-1]:
        # Within range — standard interpolation
        return float(np.interp(tau, QUANTILE_LEVELS, quantile_values))

    # Extrapolate beyond P90 using the Q80→Q90 slope
    q80 = float(quantile_values[-2])
    q90 = float(quantile_values[-1])
    spread = q90 - q80
    extra = (tau - 0.9) / 0.1 * spread  # linear extension of the last segment
    cap = 2.0 * spread  # ≈ P99 for a normal distribution
    return float(q90 + min(extra, cap))


@dataclass
class EngineCapabilities:
    """Describes the capabilities of a prediction engine."""

    name: str
    description: str
    supports_multivariate: bool = False
    supports_exogenous: bool = False
    supports_uncertainty: bool = False
    min_history_length: int = 7
    max_history_length: int | None = None  # None = no limit
    max_horizon: int = 365
    supported_frequencies: list[str] | None = None

    def __post_init__(self):
        if self.supported_frequencies is None:
            self.supported_frequencies = ["daily", "weekly", "monthly"]


class PredictionEngine(ABC):
    """Abstract base class for all prediction engines."""

    @abstractmethod
    async def predict(
        self,
        historical_data: list[dict],
        horizon: int,
        prediction_from: date,
        covariates: dict[str, dict[date, float]] | None = None,
        pad_dates: dict[str, set[date]] | None = None,
        **kwargs,
    ) -> list[PredictionResult]:
        """
        Generate predictions based on historical data.

        Args:
            historical_data: List of dicts with 'date' and 'value' keys
            horizon: Number of periods to predict
            **kwargs: Engine-specific parameters

        Returns:
            List of PredictionResult objects
        """
        pass

    @abstractmethod
    def get_capabilities(self) -> EngineCapabilities:
        """
        Return the capabilities of this prediction engine.

        Returns:
            EngineCapabilities object describing the engine
        """
        pass

    async def predict_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from: date,
        batch_size: int = 64,
    ) -> list[list[PredictionResult]]:
        """Run predictions for multiple outlets.

        Each item is a dict with keys:
          - historical_data: list[dict] with 'date' and 'value'
          - covariates: dict | None
          - pad_dates: dict | None

        Default implementation calls predict() sequentially. Override in engines
        that support GPU batching for a significant throughput improvement.
        """
        results = []
        for item in items:
            result = await self.predict(
                historical_data=item["historical_data"],
                horizon=horizon,
                prediction_from=prediction_from,
                covariates=item.get("covariates"),
                pad_dates=item.get("pad_dates"),
            )
            results.append(result)
        return results

    def apply_parameters(self, params: dict[str, str]) -> None:
        """Apply engine-specific parameters from the database.

        ``params`` is a mapping of parameter name → selected value (strings).
        Override in engines that support runtime configuration (e.g. model size,
        precision, sample count).  The default implementation is a no-op.
        """

    def get_actual_slug(self) -> str | None:
        """Return the slug of the algorithm actually used, or None to use the registered type.

        Override in engines that may degrade to a different algorithm at runtime
        (e.g. TimesFM falling back to exponential smoothing when the model isn't loaded).
        """
        return None

    def validate_input(self, historical_data: list[dict], horizon: int) -> None:
        """
        Validate input data before prediction.

        Args:
            historical_data: List of dicts with 'date' and 'value' keys
            horizon: Number of periods to predict

        Raises:
            ValueError: If input data is invalid
        """
        capabilities = self.get_capabilities()

        if len(historical_data) < capabilities.min_history_length:
            raise ValueError(
                f"Insufficient historical data. Minimum required: "
                f"{capabilities.min_history_length}, provided: {len(historical_data)}"
            )

        if horizon > capabilities.max_horizon:
            raise ValueError(
                f"Horizon exceeds maximum allowed. Maximum: "
                f"{capabilities.max_horizon}, requested: {horizon}"
            )

        if horizon < 1:
            raise ValueError("Horizon must be at least 1")
