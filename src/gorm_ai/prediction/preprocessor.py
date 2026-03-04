"""Data preprocessing utilities for prediction engines."""

from datetime import date, timedelta

import numpy as np
import pandas as pd


class DataPreprocessor:
    """Preprocesses time series data for prediction engines."""

    def __init__(self, fill_missing: bool = True, normalize: bool = False):
        """
        Initialize the preprocessor.

        Args:
            fill_missing: Whether to fill missing dates with interpolated values
            normalize: Whether to normalize values to [0, 1] range
        """
        self.fill_missing = fill_missing
        self.normalize = normalize
        self._min_value: float | None = None
        self._max_value: float | None = None

    def preprocess(self, data: list[dict]) -> pd.DataFrame:
        """
        Preprocess time series data.

        Args:
            data: List of dicts with 'date' and 'value' keys

        Returns:
            Preprocessed DataFrame with 'date' and 'value' columns
        """
        if not data:
            return pd.DataFrame(columns=["date", "value"])

        df = pd.DataFrame(data)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").reset_index(drop=True)

        if self.fill_missing:
            df = self._fill_missing_dates(df)

        if self.normalize:
            df = self._normalize_values(df)

        return df

    def _fill_missing_dates(self, df: pd.DataFrame) -> pd.DataFrame:
        """Fill missing dates with interpolated values."""
        if len(df) < 2:
            return df

        date_range = pd.date_range(start=df["date"].min(), end=df["date"].max(), freq="D")
        df = df.set_index("date").reindex(date_range)
        df["value"] = df["value"].interpolate(method="linear")
        df = df.reset_index().rename(columns={"index": "date"})
        return df

    def _normalize_values(self, df: pd.DataFrame) -> pd.DataFrame:
        """Normalize values to [0, 1] range."""
        self._min_value = df["value"].min()
        self._max_value = df["value"].max()

        if self._max_value - self._min_value > 0:
            df["value"] = (df["value"] - self._min_value) / (self._max_value - self._min_value)
        else:
            df["value"] = 0.5

        return df

    def denormalize(self, values: np.ndarray | list) -> np.ndarray:
        """
        Denormalize values back to original scale.

        Args:
            values: Normalized values

        Returns:
            Denormalized values
        """
        if self._min_value is None or self._max_value is None:
            return np.array(values)

        values = np.array(values)
        return values * (self._max_value - self._min_value) + self._min_value

    @staticmethod
    def generate_future_dates(last_date: date, horizon: int) -> list[date]:
        """
        Generate future dates for predictions.

        Args:
            last_date: Last date in historical data
            horizon: Number of future dates to generate

        Returns:
            List of future dates
        """
        return [last_date + timedelta(days=i + 1) for i in range(horizon)]

    @staticmethod
    def calculate_confidence_interval(
        predictions: np.ndarray,
        std_error: float,
        confidence_level: float = 0.95,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Calculate confidence intervals for predictions.

        Args:
            predictions: Array of predicted values
            std_error: Standard error of predictions
            confidence_level: Confidence level (default 0.95)

        Returns:
            Tuple of (lower_bounds, upper_bounds)
        """
        # Common z-scores for standard confidence levels
        z_scores = {
            0.90: 1.645,
            0.95: 1.96,
            0.99: 2.576,
        }
        z_score = z_scores.get(confidence_level, 1.96)
        margin = z_score * std_error

        lower = predictions - margin
        upper = predictions + margin

        return lower, upper
