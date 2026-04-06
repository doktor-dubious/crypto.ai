"""Abstract base class for prediction engines."""

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date

import numpy as np

from gorm_ai.schemas.prediction import PredictionResult

# Quantile levels produced by all engines (P10–P90).
QUANTILE_LEVELS = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])


def interpolate_quantile(
    tau: float,
    quantile_values: np.ndarray,
    *,
    methodology: int = 1,
    extrapolation: int = 1,
) -> float:
    """Select the EO value from the forecast distribution at critical fractile *tau*.

    Args:
        tau: Newsvendor critical fractile, typically in (0, 1).
        quantile_values: Array of quantile forecasts aligned with
            ``QUANTILE_LEVELS`` (length 9, P10–P90).
        methodology: 1 = interpolate between quantiles (smooth),
                     2 = snap to nearest quantile (legacy).
        extrapolation: 1 = extrapolate to ~E99 (cap = 2× spread),
                       2 = conservative extrapolation to ~E95 (cap = 1× spread),
                       3 = cap at E90 (no extrapolation),
                       4 = dampened (exponential decay on growth rate,
                           asymptotes to Q90 + spread).
    """
    if methodology == 2:
        # Legacy snap-to-nearest behaviour
        if extrapolation == 3 or tau <= QUANTILE_LEVELS[-1]:
            clamped = min(tau, QUANTILE_LEVELS[-1])
            nearest_idx = int(np.argmin(np.abs(QUANTILE_LEVELS - clamped)))
            return float(quantile_values[nearest_idx])
        # Snap beyond P90 — still return Q90 (snap has no between-quantile
        # extrapolation, so modes 1 and 2 both resolve to Q90)
        return float(quantile_values[-1])

    # methodology == 1: interpolate
    if tau <= QUANTILE_LEVELS[-1]:
        # Within range — standard interpolation
        return float(np.interp(tau, QUANTILE_LEVELS, quantile_values))

    if extrapolation == 3:
        # Cap at P90
        return float(quantile_values[-1])

    # Extrapolate beyond P90 using the Q80→Q90 slope
    q80 = float(quantile_values[-2])
    q90 = float(quantile_values[-1])
    spread = q90 - q80
    t = (tau - 0.9) / 0.1  # normalized distance beyond P90
    if extrapolation == 4:
        # Dampened: exponential decay on growth rate.
        # Responsive near Q90, flattens out, asymptotes to Q90 + spread.
        return float(q90 + spread * (1.0 - math.exp(-2.0 * t)))
    if extrapolation == 2:
        # Conservative: half the slope, cap at 1× spread (≈ P95)
        extra = t * spread * 0.5
        cap = 1.0 * spread
    else:
        # Aggressive: full slope, cap at 2× spread (≈ P99)
        extra = t * spread
        cap = 2.0 * spread
    return float(q90 + min(extra, cap))


@dataclass
class MemoryEstimate:
    """Estimated memory requirements for a task."""

    model_mb: float          # base model footprint in MB
    inference_mb: float      # per-batch inference overhead in MB
    total_mb: float          # total estimated peak memory in MB
    gpu_required: bool       # whether GPU VRAM is needed
    task_type: str           # "prediction", "simulation", or "finetune"
    breakdown: dict[str, float] | None = None  # optional detailed breakdown


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
    patch_size: int = 1  # time steps per patch (1 = no patching)
    supported_frequencies: list[str] | None = None

    def __post_init__(self):
        if self.supported_frequencies is None:
            self.supported_frequencies = ["daily", "weekly", "monthly"]


class PredictionEngine(ABC):
    """Abstract base class for all prediction engines."""

    allow_fallback: bool = True

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

    def estimate_memory(
        self,
        *,
        task_type: str = "prediction",
        num_outlets: int = 1,
        batch_size: int = 32,
        horizon: int = 30,
        context_length: int = 512,
        num_covariates: int = 0,
        precision: str = "bfloat16",
        epochs: int = 0,
    ) -> MemoryEstimate:
        """Estimate peak memory usage for this engine.

        Override in subclasses with engine-specific knowledge.  The default
        implementation returns a conservative estimate for CPU-only statistical
        methods.

        Args:
            task_type: "prediction", "simulation", or "finetune"
            num_outlets: total number of outlets in the task
            batch_size: outlets per forward pass
            horizon: prediction horizon in days
            context_length: history window in days
            num_covariates: number of covariate features
            precision: model dtype (float32, bfloat16, float16)
            epochs: training epochs (finetune only)
        """
        # Base implementation: lightweight statistical methods
        per_outlet_mb = (context_length + horizon) * (1 + num_covariates) * 8 / (1024 * 1024)
        batch_mb = per_outlet_mb * min(batch_size, num_outlets)
        if task_type == "simulation":
            batch_mb *= 1.5  # simulation holds more intermediate state
        return MemoryEstimate(
            model_mb=0,
            inference_mb=round(batch_mb + 50, 1),  # 50 MB baseline for Python/numpy
            total_mb=round(batch_mb + 50, 1),
            gpu_required=False,
            task_type=task_type,
        )

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

    @staticmethod
    def compute_pad_adjustments(
        historical_data: list[dict],
        future_dates: list[date],
        pad_dates: dict[str, set[date]] | None,
        active_covariate_types: set | list | None = None,
    ) -> np.ndarray:
        """Compute per-date PAD adjustments as historical mean differences.

        For each PAD type with events in the future window, computes the
        average sales difference between event days and non-event days in
        history, then applies that shift only on future event dates.

        This avoids including PAD as a Ridge regression feature, which
        distorts the intercept and affects all dates — not just event dates.

        Returns an array of length len(future_dates) with the total PAD
        adjustment per day (zero on non-event dates).
        """
        adj = np.zeros(len(future_dates))
        if not pad_dates or not historical_data:
            return adj
        if active_covariate_types is not None and 3 not in active_covariate_types:
            return adj

        future_set = set(future_dates)

        # Identify PAD types that have events in the future window
        relevant_pads: dict[str, set[date]] = {}
        for pad_name, event_dates in pad_dates.items():
            if future_set & event_dates:
                relevant_pads[pad_name] = event_dates

        if not relevant_pads:
            return adj

        # Build a date→value lookup from historical data
        hist_by_date: dict[date, float] = {}
        for record in historical_data:
            hist_by_date[record["date"]] = float(record["value"])

        # Normal-day mean (excluding ALL PAD event dates)
        all_event_dates: set[date] = set()
        for event_dates in pad_dates.values():
            all_event_dates |= event_dates

        normal_vals = [v for d, v in hist_by_date.items() if d not in all_event_dates]
        if not normal_vals:
            return adj
        normal_mean = float(np.mean(normal_vals))

        # Compute per-PAD-type effect and apply to future event dates
        for pad_name, event_dates in relevant_pads.items():
            hist_event_vals = [hist_by_date[d] for d in event_dates if d in hist_by_date]
            if not hist_event_vals:
                continue
            pad_effect = float(np.mean(hist_event_vals) - normal_mean)
            for idx, fd in enumerate(future_dates):
                if fd in event_dates:
                    adj[idx] += pad_effect

        return adj
