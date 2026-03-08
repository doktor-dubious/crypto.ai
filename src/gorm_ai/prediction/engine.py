"""Abstract base class for prediction engines."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date

from gorm_ai.schemas.prediction import PredictionResult


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
