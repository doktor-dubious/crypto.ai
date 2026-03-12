"""Google TimesFM 2.5 prediction engine."""

import asyncio
import logging
from datetime import date

import numpy as np
import pandas as pd

from gorm_ai.prediction.engine import EngineCapabilities, PredictionEngine
from gorm_ai.prediction.preprocessor import DataPreprocessor
from gorm_ai.schemas.prediction import PredictionResult

logger = logging.getLogger(__name__)


_QUANTILE_LEVELS = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])

# Number of outlets packed into a single TimesFM forward pass.
# Increase if GPU VRAM allows; decrease if you hit OOM errors.
BATCH_SIZE = 32


class TimesFMEngine(PredictionEngine):
    """Google TimesFM 2.5 (200M, PyTorch) prediction engine."""

    def __init__(self):
        self.preprocessor = DataPreprocessor(fill_missing=True, normalize=True)
        self._model = None
        self._model_loaded = False
        self._last_ridge_results: list[dict] | None = None  # set after each predict_batch call

    def get_actual_slug(self) -> str | None:
        if self._model_loaded and self._model is None:
            return "statistical"
        return None

    def get_capabilities(self) -> EngineCapabilities:
        """Return engine capabilities."""
        return EngineCapabilities(
            name="Google TimesFM",
            description="Foundation model for time series forecasting",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=32,
            max_history_length=1024,
            max_horizon=128,
            supported_frequencies=["daily", "weekly", "monthly", "hourly"],
        )

    async def predict(
        self,
        historical_data: list[dict],
        horizon: int,
        prediction_from: date,
        covariates: dict[str, dict[date, float]] | None = None,
        pad_dates: dict[str, set[date]] | None = None,
        holding_rate: float = 0.25,
        protection_days: int = 7,
        **kwargs,
    ) -> list[PredictionResult]:
        """
        Generate predictions using TimesFM.

        Args:
            historical_data: List of dicts with 'date' and 'value' keys
            horizon: Number of periods to predict
            prediction_from: First date of the prediction window
            covariates: Optional dict mapping feature name to {weekday: value}
                        (weekday 1=Monday, 7=Sunday). Used as dynamic numerical
                        covariates spanning both historical context and future horizon.
            holding_rate: Annual holding cost as a fraction of cost_per_unit (default 0.25).
                          Used to compute the Newsvendor overage cost Co over the protection period.
            protection_days: Days until next replenishment (default 7 = weekly).
                             Determines Co = cost_per_unit * (holding_rate / 365) * protection_days.
            **kwargs: Engine-specific parameters

        Returns:
            List of PredictionResult objects. Each result includes an `economic_optimal`
            field when outlet financials (profit_per_unit + cost_per_unit) are available,
            representing the Newsvendor-optimal draw: the quantile corresponding to
            τ = profit / (profit + Co), where higher margins yield higher quantiles.
        """
        self.validate_input(historical_data, horizon)

        # Preprocess data
        df = self.preprocessor.preprocess(historical_data)
        values = df["value"].values

        # Load model if not loaded
        if not self._model_loaded:
            self._load_model()

        if self._model is not None:
            # Always build covariate arrays — weekday dummies are always included,
            # financial covariates and pad event indicators are added when available.
            cov_arrays = self._build_covariate_arrays(df, prediction_from, horizon, covariates, pad_dates)
            predictions, lower, upper, all_quantiles = await self._run_inference_with_covariates(
                values, horizon, cov_arrays
            )
        else:
            # Stub: return simple forecast when model not available
            predictions, lower, upper = self._stub_forecast(values, horizon)
            all_quantiles = None

        # Denormalize predictions
        predictions = self.preprocessor.denormalize(predictions)
        lower = self.preprocessor.denormalize(lower)
        upper = self.preprocessor.denormalize(upper)
        if all_quantiles is not None:
            all_quantiles = self.preprocessor.denormalize(all_quantiles)  # (horizon, n_quantiles)

        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)

        # Build results
        results = []
        for i, pred_date in enumerate(future_dates):
            economic_optimal = self._compute_economic_optimal(
                pred_date, i, all_quantiles, covariates, holding_rate, protection_days
            )
            results.append(
                PredictionResult(
                    date=pred_date,
                    predicted_value=float(predictions[i]),
                    lower_bound=float(lower[i]),
                    upper_bound=float(upper[i]),
                    confidence=0.80,
                    economic_optimal=economic_optimal,
                )
            )

        return results

    async def predict_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from: date,
        batch_size: int = BATCH_SIZE,
        holding_rate: float = 0.25,
        protection_days: int = 7,
    ) -> list[list[PredictionResult]]:
        """Predict for multiple outlets with a single GPU forward pass per batch.

        Outlets are sorted by history length before batching to minimise padding
        waste within each batch. Per-outlet Ridge regression runs after the GPU
        step and is cheap enough to keep sequential.

        Falls back to sequential predict() calls when the model is unavailable.
        """
        if not items:
            return []

        if not self._model_loaded:
            self._load_model()

        if self._model is None:
            return await super().predict_batch(items, horizon, prediction_from)

        # Preprocess each outlet with its own DataPreprocessor (stateful min/max).
        prepared: list[dict] = []
        for item in items:
            pp = DataPreprocessor(fill_missing=True, normalize=True)
            df = pp.preprocess(item["historical_data"])
            values = df["value"].values
            cov_arrays = self._build_covariate_arrays(
                df, prediction_from, horizon,
                item.get("covariates"), item.get("pad_dates"),
            )
            n_hist = len(values)
            feature_names = sorted(cov_arrays.keys())
            hist_X = np.column_stack([cov_arrays[f][:n_hist] for f in feature_names])
            fut_X = np.column_stack([cov_arrays[f][n_hist:] for f in feature_names])
            prepared.append({
                "values": values,
                "hist_X": hist_X,
                "fut_X": fut_X,
                "feature_names": feature_names,
                "preprocessor": pp,
                "covariates": item.get("covariates"),
            })

        # Sort by history length to minimise intra-batch padding.
        order = sorted(range(len(prepared)), key=lambda i: len(prepared[i]["values"]))
        sorted_prepared = [prepared[i] for i in order]

        # Run GPU batches and collect raw (normalised) results.
        raw_results: list[tuple] = [None] * len(prepared)  # type: ignore[list-item]
        all_ridge_infos: list[dict] = [None] * len(prepared)  # type: ignore[list-item]
        loop = asyncio.get_event_loop()
        for batch_start in range(0, len(sorted_prepared), batch_size):
            batch = sorted_prepared[batch_start : batch_start + batch_size]
            batch_raw, batch_ridge = await loop.run_in_executor(
                None, self._run_batch_inference, batch, horizon
            )
            for j, (raw, ridge_info) in enumerate(zip(batch_raw, batch_ridge)):
                orig_idx = order[batch_start + j]
                raw_results[orig_idx] = raw
                all_ridge_infos[orig_idx] = ridge_info

        self._last_ridge_results = all_ridge_infos

        # Build PredictionResult lists in original item order.
        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)
        output: list[list[PredictionResult]] = []
        for i, item in enumerate(items):
            preds_norm, lower_norm, upper_norm, quantiles_norm = raw_results[i]
            pp = prepared[i]["preprocessor"]
            preds = pp.denormalize(preds_norm)
            lower = pp.denormalize(lower_norm)
            upper = pp.denormalize(upper_norm)
            quantiles = pp.denormalize(quantiles_norm)

            day_results = []
            for idx, pred_date in enumerate(future_dates):
                economic_optimal = self._compute_economic_optimal(
                    pred_date, idx, quantiles,
                    item.get("covariates"), holding_rate, protection_days,
                )
                day_results.append(PredictionResult(
                    date=pred_date,
                    predicted_value=float(preds[idx]),
                    lower_bound=float(lower[idx]),
                    upper_bound=float(upper[idx]),
                    confidence=0.80,
                    economic_optimal=economic_optimal,
                ))
            output.append(day_results)

        return output

    def _run_batch_inference(
        self,
        batch: list[dict],
        horizon: int,
    ) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], list[dict]]:
        """Sync: single TimesFM forward pass for a batch + per-outlet Ridge.

        Returns a tuple of:
          - list of (predictions, lower, upper, all_quantiles) tuples (normalised scale)
          - list of ridge_info dicts with keys: feature_names, coefficients, intercept
        """
        from sklearn.linear_model import Ridge

        inputs = [item["values"] for item in batch]
        point_forecast, quantile_forecast = self._model.forecast(
            horizon=horizon, inputs=inputs
        )
        n_backcast = point_forecast.shape[1] - horizon

        results = []
        ridge_infos = []
        for i, item in enumerate(batch):
            values = item["values"]
            hist_X = item["hist_X"]
            fut_X = item["fut_X"]

            base_pred = point_forecast[i, -horizon:]
            base_lower = quantile_forecast[i, -horizon:, 1]
            base_upper = quantile_forecast[i, -horizon:, -1]
            base_all_q = quantile_forecast[i, -horizon:, 1:]

            backcast = point_forecast[i, :n_backcast]
            align_len = min(len(values), n_backcast)
            residuals = values[-align_len:] - backcast[-align_len:]
            hist_X_aligned = hist_X[-align_len:]

            feature_names = sorted(item.get("feature_names", []))
            ridge = Ridge(alpha=1.0, fit_intercept=True)
            ridge.fit(hist_X_aligned, residuals)
            adj = ridge.predict(fut_X)

            ridge_infos.append({
                "feature_names": feature_names,
                "coefficients": list(ridge.coef_),
                "intercept": float(ridge.intercept_),
            })

            results.append((
                base_pred + adj,
                base_lower + adj,
                base_upper + adj,
                base_all_q + adj[:, np.newaxis],
            ))

        return results, ridge_infos

    def _compute_economic_optimal(
        self,
        pred_date: date,
        day_index: int,
        all_quantiles: np.ndarray | None,
        covariates: dict[str, dict[date, float]] | None,
        holding_rate: float,
        protection_days: int,
    ) -> float | None:
        """Compute the Newsvendor-optimal draw for a single forecast day.

        Uses the critical fractile τ = Cu / (Cu + Co) to select the appropriate
        quantile from the full forecast distribution, where:
          - cost_per_unit   = production cost per unit (Co: wasted on unsold units)
          - profit_per_unit = selling price per unit
          - Cu              = selling_price − production_cost (margin lost per missed sale)
          - τ               = (profit − cost) / profit

        Returns None when quantile data or financial data is unavailable, or when
        selling price ≤ production cost (economically invalid).
        """
        if all_quantiles is None:
            logger.debug("EO: no quantile data available")
            return None
        if covariates is None:
            logger.debug("EO: no covariates (cost/profit not configured)")
            return None

        selling_price = covariates.get("profit_per_unit", {}).get(pred_date, 0.0)
        production_cost = covariates.get("cost_per_unit", {}).get(pred_date, 0.0)
        if selling_price <= 0 or production_cost <= 0 or selling_price <= production_cost:
            logger.debug(
                "EO: invalid financials on %s — selling_price(profit_per_unit)=%.4f "
                "production_cost(cost_per_unit)=%.4f (need 0 < cost < price)",
                pred_date, selling_price, production_cost,
            )
            return None

        tau = (selling_price - production_cost) / selling_price
        nearest_idx = int(np.argmin(np.abs(_QUANTILE_LEVELS - tau)))
        return float(all_quantiles[day_index, nearest_idx])

    def _apply_hf_env(self) -> None:
        """Push HF_TOKEN and HF_HUB_CACHE from settings into os.environ.

        huggingface_hub reads these directly from the process environment, not
        from pydantic-settings. Call this before any from_pretrained() invocation.
        Relative HF_HUB_CACHE paths are resolved to absolute so they work
        regardless of the process working directory.
        """
        import os

        from gorm_ai.config import get_settings

        s = get_settings()
        if s.hf_token:
            os.environ.setdefault("HF_TOKEN", s.hf_token)
        if s.hf_hub_cache:
            abs_cache = os.path.abspath(s.hf_hub_cache)
            os.environ.setdefault("HF_HUB_CACHE", abs_cache)
            logger.debug("HF_HUB_CACHE set to '%s'", abs_cache)

    def _load_model(self) -> None:
        """Load TimesFM 2.5 (200M PyTorch) from HuggingFace."""
        if self._model_loaded:
            return
        self._apply_hf_env()
        try:
            import timesfm

            self._model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
                "google/timesfm-2.5-200m-pytorch",
            )
            self._model.compile(
                timesfm.ForecastConfig(
                    max_context=1024,
                    max_horizon=128,
                    normalize_inputs=True,
                    use_continuous_quantile_head=True,
                    force_flip_invariance=True,
                    infer_is_positive=True,
                    fix_quantile_crossing=True,
                    return_backcast=True,  # required for forecast_with_covariates
                )
            )
            logger.info("TimesFM 2.5 model loaded successfully")
        except Exception as e:
            logger.warning(f"Failed to load TimesFM model, falling back to stub: {e}")
            self._model = None
        finally:
            self._model_loaded = True

    def _build_covariate_arrays(
        self,
        df: pd.DataFrame,
        prediction_from: date,
        horizon: int,
        covariates: dict[str, dict[date, float]] | None = None,
        pad_dates: dict[str, set[date]] | None = None,
    ) -> dict[str, list[float]]:
        """Build full covariate sequences covering historical context + future horizon.

        Always includes weekday one-hot features (dow_1..dow_6; Sunday is the reference
        category and is omitted). Financial covariates (date-keyed) and pad event
        indicators (date-keyed binary) are added when provided.

        Args:
            df: Preprocessed historical DataFrame with 'date' column (pd.Timestamps)
            prediction_from: First date of the prediction window
            horizon: Number of future periods
            covariates: Optional feature name → {date: value} (fully resolved per date)
            pad_dates: Optional pad name → set of specific event dates (binary indicator)

        Returns:
            Feature name → flat list of floats, length = len(df) + horizon
        """
        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)

        # Build parallel date lists (as date objects) for all positions
        historical_dates = [ts.date() for ts in df["date"]]
        all_dates = historical_dates + list(future_dates)

        # weekday() returns 0=Monday, 6=Sunday → +1 gives 1=Monday, 7=Sunday
        all_weekdays = [d.weekday() + 1 for d in all_dates]

        result: dict[str, list[float]] = {}

        # Weekday one-hot encoding (1=Mon … 6=Sat; 7=Sun is the reference category)
        for dow in range(1, 7):
            result[f"dow_{dow}"] = [1.0 if wd == dow else 0.0 for wd in all_weekdays]

        # Financial covariates keyed by date — profit_per_unit is excluded because
        # it reflects margin, not end-user price, and does not influence demand.
        _EXCLUDED_COVARIATES = {"profit_per_unit"}
        if covariates:
            for feature, date_map in covariates.items():
                if feature not in _EXCLUDED_COVARIATES:
                    result[feature] = [float(date_map.get(d, 0.0)) for d in all_dates]

        # Pad event indicators — binary 1.0 on event dates, 0.0 otherwise
        # Ridge learns the per-outlet effect magnitude from historical occurrences
        if pad_dates:
            for pad_name, event_dates in pad_dates.items():
                result[pad_name] = [1.0 if d in event_dates else 0.0 for d in all_dates]

        return result

    async def _run_inference(
        self,
        values: np.ndarray,
        horizon: int,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Run plain inference (no covariates). Offloaded to thread pool."""
        loop = asyncio.get_event_loop()
        point_forecast, quantile_forecast = await loop.run_in_executor(
            None,
            lambda: self._model.forecast(horizon=horizon, inputs=[values]),
        )
        # With return_backcast=True the output includes context + horizon;
        # take the last `horizon` elements which are the actual forecast.
        predictions = point_forecast[0, -horizon:]
        lower = quantile_forecast[0, -horizon:, 1]   # P10 (index 0 is mean)
        upper = quantile_forecast[0, -horizon:, -1]  # P90
        return predictions, lower, upper

    async def _run_inference_with_covariates(
        self,
        values: np.ndarray,
        horizon: int,
        cov_arrays: dict[str, list[float]],
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Run inference with dynamic numerical covariates. Offloaded to thread pool.

        Uses a Ridge regression (xreg) on top of the base TimesFM forecast:
        1. Run base forecast — with return_backcast=True the output contains both
           the historical reconstruction (backcast) and the future forecast.
        2. Compute residuals = actual_values - backcast (what TimesFM missed)
        3. Fit Ridge on residuals: residuals ~ historical_covariates
           Ridge's intercept absorbs any systematic bias (e.g. consistent underestimation).
        4. xreg_adjustment = ridge.predict(future_covariates)
        5. Add adjustment to base forecast, confidence intervals, and all quantiles.

        Returns:
            Tuple of (predictions, lower, upper, all_quantiles) where all_quantiles has
            shape (horizon, n_quantiles) with quantile levels P10..P90 (see _QUANTILE_LEVELS).
        """
        loop = asyncio.get_event_loop()

        def _infer():
            from sklearn.linear_model import Ridge

            n_hist = len(values)
            feature_names = sorted(cov_arrays.keys())
            hist_X = np.column_stack([cov_arrays[f][:n_hist] for f in feature_names])
            fut_X = np.column_stack([cov_arrays[f][n_hist:] for f in feature_names])

            # Get base TimesFM forecast (includes backcast due to return_backcast=True)
            point_forecast, quantile_forecast = self._model.forecast(
                horizon=horizon, inputs=[values]
            )
            base_pred = point_forecast[0, -horizon:]
            # Index 0 in quantile_forecast is the mean/point head; P10–P90 start at index 1.
            base_lower = quantile_forecast[0, -horizon:, 1]   # P10
            base_upper = quantile_forecast[0, -horizon:, -1]  # P90
            base_all_quantiles = quantile_forecast[0, -horizon:, 1:]  # (horizon, 9) P10–P90

            # Extract backcast and align with actual values.
            # The backcast covers up to the model's context length (may differ from n_hist).
            n_backcast = point_forecast.shape[1] - horizon
            backcast = point_forecast[0, :n_backcast]
            align_len = min(n_hist, n_backcast)
            residuals = values[-align_len:] - backcast[-align_len:]
            hist_X_aligned = hist_X[-align_len:]

            # Fit Ridge on residuals — learns only what TimesFM couldn't explain.
            # The intercept captures systematic bias (consistent over/underestimation).
            ridge = Ridge(alpha=1.0, fit_intercept=True)
            ridge.fit(hist_X_aligned, residuals)

            xreg_adjustment = ridge.predict(fut_X)

            return (
                base_pred + xreg_adjustment,
                base_lower + xreg_adjustment,
                base_upper + xreg_adjustment,
                base_all_quantiles + xreg_adjustment[:, np.newaxis],
            )

        return await loop.run_in_executor(None, _infer)

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
