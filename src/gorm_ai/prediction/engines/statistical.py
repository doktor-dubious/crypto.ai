"""Statistical prediction engine using ARIMA and simple methods."""

import numpy as np

from gorm_ai.prediction.engine import EngineCapabilities, PredictionEngine
from gorm_ai.prediction.preprocessor import DataPreprocessor
from gorm_ai.schemas.prediction import PredictionResult


class StatisticalEngine(PredictionEngine):
    """
    Statistical prediction engine using simple forecasting methods.

    Supports:
    - Simple moving average
    - Exponential smoothing
    - ARIMA (when statsmodels is available)
    """

    def __init__(self):
        self.preprocessor = DataPreprocessor(fill_missing=True, normalize=False)

    def get_capabilities(self) -> EngineCapabilities:
        """Return engine capabilities."""
        return EngineCapabilities(
            name="Statistical Engine",
            description="Statistical forecasting using moving averages and exponential smoothing",
            supports_multivariate=False,
            supports_exogenous=False,
            supports_uncertainty=True,
            min_history_length=7,
            max_horizon=365,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    async def predict(
        self,
        historical_data: list[dict],
        horizon: int,
        method: str = "exponential_smoothing",
        **kwargs,
    ) -> list[PredictionResult]:
        """
        Generate predictions using statistical methods.

        Args:
            historical_data: List of dicts with 'date' and 'value' keys
            horizon: Number of periods to predict
            method: Prediction method ('moving_average', 'exponential_smoothing', 'arima')
            **kwargs: Method-specific parameters

        Returns:
            List of PredictionResult objects
        """
        self.validate_input(historical_data, horizon)

        # Preprocess data
        df = self.preprocessor.preprocess(historical_data)
        values = df["value"].values
        last_date = df["date"].iloc[-1].date()

        # Generate predictions based on method
        if method == "moving_average":
            predictions, std_error = self._moving_average(values, horizon, **kwargs)
        elif method == "arima":
            predictions, std_error = await self._arima(values, horizon, **kwargs)
        else:  # Default to exponential smoothing
            predictions, std_error = self._exponential_smoothing(values, horizon, **kwargs)

        # Generate future dates
        future_dates = DataPreprocessor.generate_future_dates(last_date, horizon)

        # Calculate confidence intervals
        lower_bounds, upper_bounds = DataPreprocessor.calculate_confidence_interval(
            predictions, std_error
        )

        # Build results
        results = []
        for i, pred_date in enumerate(future_dates):
            results.append(
                PredictionResult(
                    date=pred_date,
                    predicted_value=float(predictions[i]),
                    lower_bound=float(lower_bounds[i]),
                    upper_bound=float(upper_bounds[i]),
                    confidence=0.95,
                )
            )

        return results

    def _moving_average(
        self,
        values: np.ndarray,
        horizon: int,
        window: int = 7,
        **kwargs,
    ) -> tuple[np.ndarray, float]:
        """
        Simple moving average forecast.

        Args:
            values: Historical values
            horizon: Number of periods to predict
            window: Moving average window size

        Returns:
            Tuple of (predictions, standard_error)
        """
        window = min(window, len(values))
        recent_values = values[-window:]
        mean_value = np.mean(recent_values)
        std_error = np.std(recent_values)

        predictions = np.full(horizon, mean_value)
        return predictions, std_error

    def _exponential_smoothing(
        self,
        values: np.ndarray,
        horizon: int,
        alpha: float = 0.3,
        **kwargs,
    ) -> tuple[np.ndarray, float]:
        """
        Simple exponential smoothing forecast.

        Args:
            values: Historical values
            horizon: Number of periods to predict
            alpha: Smoothing parameter (0 < alpha < 1)

        Returns:
            Tuple of (predictions, standard_error)
        """
        # Calculate smoothed values
        smoothed = np.zeros(len(values))
        smoothed[0] = values[0]

        for i in range(1, len(values)):
            smoothed[i] = alpha * values[i] + (1 - alpha) * smoothed[i - 1]

        # Forecast is the last smoothed value
        last_smoothed = smoothed[-1]
        predictions = np.full(horizon, last_smoothed)

        # Calculate standard error from residuals
        residuals = values - smoothed
        std_error = np.std(residuals)

        return predictions, std_error

    async def _arima(
        self,
        values: np.ndarray,
        horizon: int,
        order: tuple[int, int, int] = (1, 1, 1),
        **kwargs,
    ) -> tuple[np.ndarray, float]:
        """
        ARIMA forecast (requires statsmodels).

        Args:
            values: Historical values
            horizon: Number of periods to predict
            order: ARIMA order (p, d, q)

        Returns:
            Tuple of (predictions, standard_error)
        """
        try:
            from statsmodels.tsa.arima.model import ARIMA

            model = ARIMA(values, order=order)
            fitted = model.fit()
            forecast = fitted.forecast(steps=horizon)
            std_error = np.sqrt(fitted.mse)

            return np.array(forecast), std_error

        except ImportError:
            # Fall back to exponential smoothing if statsmodels not available
            return self._exponential_smoothing(values, horizon, **kwargs)
