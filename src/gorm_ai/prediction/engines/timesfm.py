"""Google TimesFM prediction engine stub."""

import numpy as np

from gorm_ai.prediction.engine import EngineCapabilities, PredictionEngine
from gorm_ai.prediction.preprocessor import DataPreprocessor
from gorm_ai.schemas.prediction import PredictionResult


class TimesFMEngine(PredictionEngine):
    """
    Google TimesFM prediction engine.

    This is a stub implementation - full implementation requires
    the transformers library and model weights.
    """

    def __init__(self):
        self.preprocessor = DataPreprocessor(fill_missing=True, normalize=True)
        self._model = None

    def get_capabilities(self) -> EngineCapabilities:
        """Return engine capabilities."""
        return EngineCapabilities(
            name="Google TimesFM",
            description="Foundation model for time series forecasting",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=32,
            max_horizon=128,
            supported_frequencies=["daily", "weekly", "monthly", "hourly"],
        )

    async def predict(
        self,
        historical_data: list[dict],
        horizon: int,
        **kwargs,
    ) -> list[PredictionResult]:
        """
        Generate predictions using TimesFM.

        Args:
            historical_data: List of dicts with 'date' and 'value' keys
            horizon: Number of periods to predict
            **kwargs: Engine-specific parameters

        Returns:
            List of PredictionResult objects
        """
        self.validate_input(historical_data, horizon)

        # Preprocess data
        df = self.preprocessor.preprocess(historical_data)
        values = df["value"].values
        last_date = df["date"].iloc[-1].date()

        # Load model if not loaded
        if self._model is None:
            self._load_model()

        if self._model is not None:
            # Run inference with actual model
            predictions, lower, upper = await self._run_inference(values, horizon)
        else:
            # Stub: return simple forecast when model not available
            predictions, lower, upper = self._stub_forecast(values, horizon)

        # Denormalize predictions
        predictions = self.preprocessor.denormalize(predictions)
        lower = self.preprocessor.denormalize(lower)
        upper = self.preprocessor.denormalize(upper)

        # Generate future dates
        future_dates = DataPreprocessor.generate_future_dates(last_date, horizon)

        # Build results
        results = []
        for i, pred_date in enumerate(future_dates):
            results.append(
                PredictionResult(
                    date=pred_date,
                    predicted_value=float(predictions[i]),
                    lower_bound=float(lower[i]),
                    upper_bound=float(upper[i]),
                    confidence=0.95,
                )
            )

        return results

    def _load_model(self) -> None:
        """Load the TimesFM model."""
        try:
            # Placeholder for actual model loading
            # In production, this would load from HuggingFace or local weights
            # from transformers import AutoModelForCausalLM
            # self._model = AutoModelForCausalLM.from_pretrained("google/timesfm")
            pass
        except Exception:
            self._model = None

    async def _run_inference(
        self,
        values: np.ndarray,
        horizon: int,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Run inference with the TimesFM model.

        Args:
            values: Preprocessed historical values
            horizon: Number of periods to predict

        Returns:
            Tuple of (predictions, lower_bounds, upper_bounds)
        """
        # Placeholder for actual inference
        # In production, this would run the model forward pass
        return self._stub_forecast(values, horizon)

    def _stub_forecast(
        self,
        values: np.ndarray,
        horizon: int,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Generate stub forecasts when model is not available.

        Uses simple exponential smoothing as a fallback.
        """
        # Simple exponential smoothing
        alpha = 0.3
        smoothed = np.zeros(len(values))
        smoothed[0] = values[0]

        for i in range(1, len(values)):
            smoothed[i] = alpha * values[i] + (1 - alpha) * smoothed[i - 1]

        last_smoothed = smoothed[-1]
        predictions = np.full(horizon, last_smoothed)

        # Calculate confidence intervals
        std_error = np.std(values - smoothed)
        z_score = 1.96  # 95% confidence

        lower = predictions - z_score * std_error
        upper = predictions + z_score * std_error

        return predictions, lower, upper
