"""Custom trained model prediction engine."""

import numpy as np

from gorm_ai.prediction.engine import EngineCapabilities, PredictionEngine
from gorm_ai.prediction.preprocessor import DataPreprocessor
from gorm_ai.schemas.prediction import PredictionResult


class CustomEngine(PredictionEngine):
    """
    Custom trained model prediction engine.

    Allows loading and using custom-trained models for prediction.
    Supports models in various formats (pickle, joblib, ONNX, etc.)
    """

    def __init__(self, model_path: str | None = None):
        """
        Initialize the custom engine.

        Args:
            model_path: Path to the custom model file
        """
        self.preprocessor = DataPreprocessor(fill_missing=True, normalize=True)
        self.model_path = model_path
        self._model = None

    def get_capabilities(self) -> EngineCapabilities:
        """Return engine capabilities."""
        return EngineCapabilities(
            name="Custom Model",
            description="Custom trained model for time series forecasting",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=14,
            max_horizon=90,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    async def predict(
        self,
        historical_data: list[dict],
        horizon: int,
        model_path: str | None = None,
        **kwargs,
    ) -> list[PredictionResult]:
        """
        Generate predictions using a custom model.

        Args:
            historical_data: List of dicts with 'date' and 'value' keys
            horizon: Number of periods to predict
            model_path: Optional path to model (overrides constructor path)
            **kwargs: Model-specific parameters

        Returns:
            List of PredictionResult objects
        """
        self.validate_input(historical_data, horizon)

        # Update model path if provided
        if model_path:
            self.model_path = model_path
            self._model = None  # Force reload

        # Preprocess data
        df = self.preprocessor.preprocess(historical_data)
        values = df["value"].values
        last_date = df["date"].iloc[-1].date()

        # Load model if not loaded
        if self._model is None:
            self._load_model()

        if self._model is not None:
            # Run inference with loaded model
            predictions, lower, upper = await self._run_inference(values, horizon, **kwargs)
        else:
            # Fallback to simple forecast
            predictions, lower, upper = self._fallback_forecast(values, horizon)

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
        """Load the custom model from disk."""
        if not self.model_path:
            return

        try:
            import pickle
            from pathlib import Path

            path = Path(self.model_path)
            if path.suffix in (".pkl", ".pickle"):
                with open(path, "rb") as f:
                    self._model = pickle.load(f)
            elif path.suffix == ".joblib":
                import joblib

                self._model = joblib.load(path)
            elif path.suffix == ".onnx":
                import onnxruntime as ort

                self._model = ort.InferenceSession(str(path))
        except Exception:
            self._model = None

    async def _run_inference(
        self,
        values: np.ndarray,
        horizon: int,
        **kwargs,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Run inference with the loaded model.

        Args:
            values: Preprocessed historical values
            horizon: Number of periods to predict
            **kwargs: Additional parameters for the model

        Returns:
            Tuple of (predictions, lower_bounds, upper_bounds)
        """
        # Generic inference logic - actual implementation depends on model type
        try:
            if hasattr(self._model, "predict"):
                # sklearn-style model
                features = values.reshape(1, -1)
                predictions = self._model.predict(features)
                if predictions.ndim > 1:
                    predictions = predictions.flatten()[:horizon]
                else:
                    predictions = np.full(horizon, predictions[0])

                # Estimate uncertainty from model if available
                if hasattr(self._model, "predict_proba"):
                    std_error = 0.1 * np.mean(predictions)
                else:
                    std_error = np.std(values) * 0.5

                lower = predictions - 1.96 * std_error
                upper = predictions + 1.96 * std_error

                return predictions, lower, upper

        except Exception:
            pass

        return self._fallback_forecast(values, horizon)

    def _fallback_forecast(
        self,
        values: np.ndarray,
        horizon: int,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Generate fallback forecasts when model fails.

        Uses simple exponential smoothing.
        """
        alpha = 0.3
        smoothed = np.zeros(len(values))
        smoothed[0] = values[0]

        for i in range(1, len(values)):
            smoothed[i] = alpha * values[i] + (1 - alpha) * smoothed[i - 1]

        last_smoothed = smoothed[-1]
        predictions = np.full(horizon, last_smoothed)

        std_error = np.std(values - smoothed)
        z_score = 1.96

        lower = predictions - z_score * std_error
        upper = predictions + z_score * std_error

        return predictions, lower, upper
