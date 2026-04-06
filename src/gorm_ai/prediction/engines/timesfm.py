"""Google TimesFM 2.5 prediction engine."""

import asyncio
import logging
from datetime import date, timedelta

import numpy as np
import pandas as pd

from gorm_ai.prediction.engine import (
    EngineCapabilities,
    MemoryEstimate,
    PredictionEngine,
    interpolate_quantile,
)
from gorm_ai.prediction.preprocessor import DataPreprocessor
from gorm_ai.schemas.prediction import PredictionResult

logger = logging.getLogger(__name__)


_QUANTILE_LEVELS = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])


def _sanitize_nan(arr: np.ndarray) -> np.ndarray:
    """Replace NaN values with 0.  A zero forecast is always safer than NaN."""
    result = np.array(arr)
    mask = np.isnan(result)
    if mask.any():
        result[mask] = 0.0
    return result

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
            patch_size=32,
            supported_frequencies=["daily", "weekly", "monthly", "hourly"],
        )

    def estimate_memory(self, *, task_type: str = "prediction", num_outlets: int = 1,
                        batch_size: int = 32, horizon: int = 30, context_length: int = 512,
                        num_covariates: int = 0, precision: str = "bfloat16",
                        epochs: int = 0) -> MemoryEstimate:
        # TimesFM 2.5: 200M params
        bytes_per_param = 2 if precision in ("bfloat16", "float16") else 4
        model_mb = 200e6 * bytes_per_param / (1024 * 1024)
        # Per-batch: context tensor + quantile output + Ridge regression
        effective_batch = min(batch_size, num_outlets)
        batch_tensor_mb = effective_batch * context_length * 4 / (1024 * 1024)
        output_mb = effective_batch * horizon * 9 * 4 / (1024 * 1024)  # 9 quantiles
        cov_bytes = (context_length + horizon) * num_covariates * 8
        ridge_mb = effective_batch * cov_bytes / (1024 * 1024)
        inference_mb = batch_tensor_mb + output_mb + ridge_mb + 200  # 200 MB PyTorch overhead

        multiplier = 1.0
        if task_type == "finetune":
            multiplier = 4.0  # optimizer states + gradients + activations
            inference_mb += epochs * 0.5  # small per-epoch overhead
        elif task_type == "simulation":
            multiplier = 1.3  # extra intermediate state

        total = model_mb + inference_mb * multiplier
        return MemoryEstimate(
            model_mb=round(model_mb, 1),
            inference_mb=round(inference_mb * multiplier, 1),
            total_mb=round(total, 1),
            gpu_required=False,
            task_type=task_type,
            breakdown={"model": round(model_mb, 1), "batch_tensor": round(batch_tensor_mb, 1),
                       "output": round(output_mb, 1), "ridge": round(ridge_mb, 1),
                       "pytorch_overhead": 200},
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
            weekday_correction = kwargs.get("weekday_correction")
            cov_arrays = self._build_covariate_arrays(
                df, prediction_from, horizon, covariates, pad_dates, weekday_correction,
                active_covariate_types=kwargs.get("active_covariate_types"),
            )
            covariate_handling = kwargs.get("covariate_handling", "external")
            predictions, lower, upper, all_quantiles = await self._run_inference_with_covariates(
                values, horizon, cov_arrays, covariate_handling
            )
        else:
            # Stub: return simple forecast when model not available
            predictions, lower, upper = self._stub_forecast(values, horizon)
            all_quantiles = None

        # Denormalize predictions and sanitize NaN
        predictions = _sanitize_nan(self.preprocessor.denormalize(predictions))
        lower = _sanitize_nan(self.preprocessor.denormalize(lower))
        upper = _sanitize_nan(self.preprocessor.denormalize(upper))
        if all_quantiles is not None:
            all_quantiles = _sanitize_nan(self.preprocessor.denormalize(all_quantiles))

        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)

        # Apply weekday profile correction in denormalized space
        wpc = kwargs.get("weekday_profile_correction", {})
        if (wpc.get("enabled") if isinstance(wpc, dict) else wpc) and all_quantiles is not None:
            predictions, all_quantiles = self._apply_weekday_profile_correction(
                predictions, all_quantiles, historical_data, future_dates,
                strength=wpc.get("strength", 1.0) if isinstance(wpc, dict) else 1.0,
                threshold=wpc.get("threshold", 0.0) if isinstance(wpc, dict) else 0.0,
                method=wpc.get("method", 1) if isinstance(wpc, dict) else 1,
            )
            lower = all_quantiles[:, 0]
            upper = all_quantiles[:, -1]

        # Build results
        va = kwargs.get("variation_adjustment", {})
        weekday_cvs = None
        if va.get("enabled") if isinstance(va, dict) else va:
            days = va.get("history_days", 365) if isinstance(va, dict) else 365
            weekday_cvs = self._compute_weekday_cvs(historical_data, days)

        eo_params = kwargs.get("eo_params", {})
        eo_meth = eo_params.get("methodology", 1) if isinstance(eo_params, dict) else 1
        eo_extrap = eo_params.get("extrapolation", 1) if isinstance(eo_params, dict) else 1

        results = []
        for i, pred_date in enumerate(future_dates):
            economic_optimal = self._compute_economic_optimal(
                pred_date, i, all_quantiles, covariates, holding_rate, protection_days,
                weekday_cvs=weekday_cvs,
                eo_methodology=eo_meth, eo_extrapolation=eo_extrap,
            )
            results.append(
                PredictionResult(
                    date=pred_date,
                    predicted_value=float(predictions[i]),
                    lower_bound=float(lower[i]),
                    upper_bound=float(upper[i]),
                    confidence=0.80,
                    economic_optimal=economic_optimal,
                    quantiles=[float(all_quantiles[i, j]) for j in range(all_quantiles.shape[1])] if all_quantiles is not None else None,
                    cv=weekday_cvs.get(pred_date.weekday()) if weekday_cvs else None,
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
                item.get("weekday_correction"),
                active_covariate_types=item.get("active_covariate_types"),
            )
            n_hist = len(values)
            feature_names = sorted(cov_arrays.keys())
            if feature_names:
                hist_X = np.column_stack([cov_arrays[f][:n_hist] for f in feature_names])
                fut_X = np.column_stack([cov_arrays[f][n_hist:] for f in feature_names])
            else:
                hist_X = np.empty((n_hist, 0))
                fut_X = np.empty((horizon, 0))
            prepared.append({
                "values": values,
                "hist_X": hist_X,
                "fut_X": fut_X,
                "cov_arrays": cov_arrays,
                "feature_names": feature_names,
                "covariate_handling": item.get("covariate_handling", "external"),
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
            preds = _sanitize_nan(pp.denormalize(preds_norm))
            lower = _sanitize_nan(pp.denormalize(lower_norm))
            upper = _sanitize_nan(pp.denormalize(upper_norm))
            quantiles = _sanitize_nan(pp.denormalize(quantiles_norm))

            wpc = item.get("weekday_profile_correction", {})
            if wpc.get("enabled") if isinstance(wpc, dict) else wpc:
                preds, quantiles = self._apply_weekday_profile_correction(
                    preds, quantiles, item["historical_data"], future_dates,
                    strength=wpc.get("strength", 1.0) if isinstance(wpc, dict) else 1.0,
                    threshold=wpc.get("threshold", 0.0) if isinstance(wpc, dict) else 0.0,
                    method=wpc.get("method", 1) if isinstance(wpc, dict) else 1,
                )
                lower = quantiles[:, 0]
                upper = quantiles[:, -1]

            va = item.get("variation_adjustment", {})
            weekday_cvs = None
            if va.get("enabled") if isinstance(va, dict) else va:
                days = (
                    va.get("history_days", 365)
                    if isinstance(va, dict) else 365
                )
                weekday_cvs = self._compute_weekday_cvs(
                    item["historical_data"], days,
                )

            eo_params = item.get("eo_params", {})
            eo_meth = eo_params.get("methodology", 1) if isinstance(eo_params, dict) else 1
            eo_extrap = eo_params.get("extrapolation", 1) if isinstance(eo_params, dict) else 1

            day_results = []
            for idx, pred_date in enumerate(future_dates):
                economic_optimal = self._compute_economic_optimal(
                    pred_date, idx, quantiles,
                    item.get("covariates"), holding_rate, protection_days,
                    weekday_cvs=weekday_cvs,
                    eo_methodology=eo_meth, eo_extrapolation=eo_extrap,
                )
                day_results.append(PredictionResult(
                    date=pred_date,
                    predicted_value=float(preds[idx]),
                    lower_bound=float(lower[idx]),
                    upper_bound=float(upper[idx]),
                    confidence=0.80,
                    economic_optimal=economic_optimal,
                    quantiles=[float(quantiles[idx, j]) for j in range(quantiles.shape[1])],
                    cv=weekday_cvs.get(pred_date.weekday()) if weekday_cvs else None,
                ))
            output.append(day_results)

        return output

    @staticmethod
    def _format_covariates_for_native(
        batch: list[dict],
    ) -> dict[str, list[list[float]]]:
        """Build native forecast_with_covariates format from per-outlet cov_arrays.

        Native API expects: {feature_name: [[outlet_0_values], [outlet_1_values], ...]}
        Each outlet's cov_arrays is: {feature_name: [values_covering_hist+horizon]}
        """
        all_features: set[str] = set()
        for item in batch:
            all_features.update(item.get("cov_arrays", {}).keys())
        if not all_features:
            return {}

        sorted_features = sorted(all_features)
        result: dict[str, list[list[float]]] = {f: [] for f in sorted_features}
        for item in batch:
            cov = item.get("cov_arrays", {})
            n_total = len(item["values"]) + item["fut_X"].shape[0]
            for f in sorted_features:
                if f in cov:
                    result[f].append(cov[f])
                else:
                    result[f].append([0.0] * n_total)
        return result

    @staticmethod
    def _fit_ridge_for_persistence(
        values: np.ndarray,
        backcast: np.ndarray,
        hist_X: np.ndarray,
        fut_X: np.ndarray,
        feature_names: list[str],
        horizon: int,
    ) -> tuple[np.ndarray, dict]:
        """Fit sklearn Ridge on residuals to extract coefficients for persistence.

        Returns (adjustment_array, ridge_info_dict).
        """
        from sklearn.linear_model import Ridge

        n_backcast = len(backcast)
        align_len = min(len(values), n_backcast)
        ridge = Ridge(alpha=1.0, fit_intercept=True)

        if align_len == 0 or not feature_names:
            adj = np.zeros(horizon)
        else:
            residuals = values[-align_len:] - backcast[-align_len:]
            hist_X_aligned = hist_X[-align_len:]
            valid = ~np.isnan(residuals)
            if hist_X_aligned.ndim == 2:
                valid &= ~np.isnan(hist_X_aligned).any(axis=1)
            else:
                valid &= ~np.isnan(hist_X_aligned)

            if valid.sum() >= 2:
                ridge.fit(hist_X_aligned[valid], residuals[valid])
                adj = ridge.predict(fut_X)
            else:
                adj = np.zeros(horizon)

        ridge_info = {
            "feature_names": feature_names,
            "coefficients": list(ridge.coef_) if hasattr(ridge, "coef_") else [],
            "intercept": float(ridge.intercept_) if hasattr(ridge, "intercept_") else 0.0,
        }
        return adj, ridge_info

    def _run_batch_inference(
        self,
        batch: list[dict],
        horizon: int,
    ) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], list[dict]]:
        """Sync: single TimesFM forward pass for a batch + covariate handling.

        Returns a tuple of:
          - list of (predictions, lower, upper, all_quantiles) tuples (normalised scale)
          - list of ridge_info dicts with keys: feature_names, coefficients, intercept
        """
        inputs = [item["values"] for item in batch]
        covariate_handling = batch[0].get("covariate_handling", "external")

        # Recompile with context matching the SHORTEST input in this batch.
        # TimesFM's attention produces NaN for any zero-padded positions, so
        # we size the context so that every input fills it completely.
        min_len = min(len(v) for v in inputs)
        self._compile_for_context(min_len)

        # --- Native covariate mode: use forecast_with_covariates() ---
        if covariate_handling == "native" and any(item.get("cov_arrays") for item in batch):
            dyn_num_covs = self._format_covariates_for_native(batch)
            if dyn_num_covs:
                try:
                    point_forecast, quantile_forecast = self._model.forecast_with_covariates(
                        inputs=inputs,
                        dynamic_numerical_covariates=dyn_num_covs,
                        xreg_mode="xreg + timesfm",
                        ridge=1.0,
                        normalize_xreg_target_per_input=True,
                    )
                except Exception:
                    logger.warning(
                        "timesfm: forecast_with_covariates failed, falling back to external Ridge",
                        exc_info=True,
                    )
                    covariate_handling = "external"
                else:
                    point_forecast = np.asarray(point_forecast)
                    quantile_forecast = np.asarray(quantile_forecast)
                    forecast_nan = np.isnan(point_forecast[:, -horizon:])
                    if forecast_nan.any():
                        n_outlets_nan = int(forecast_nan.any(axis=1).sum())
                        logger.warning(
                            "timesfm: native covariate forecast returned NaN for %d/%d outlets",
                            n_outlets_nan, len(batch),
                        )
                    n_backcast = point_forecast.shape[1] - horizon

                    results = []
                    ridge_infos = []
                    for i, item in enumerate(batch):
                        base_pred = point_forecast[i, -horizon:]
                        base_lower = quantile_forecast[i, -horizon:, 1]
                        base_upper = quantile_forecast[i, -horizon:, -1]
                        base_all_q = quantile_forecast[i, -horizon:, 1:]

                        backcast = point_forecast[i, :n_backcast]
                        feature_names = sorted(item.get("feature_names", []))
                        _, ridge_info = self._fit_ridge_for_persistence(
                            item["values"], backcast, item["hist_X"], item["fut_X"],
                            feature_names, horizon,
                        )
                        ridge_infos.append(ridge_info)

                        results.append((
                            _sanitize_nan(base_pred),
                            _sanitize_nan(base_lower),
                            _sanitize_nan(base_upper),
                            _sanitize_nan(base_all_q),
                        ))
                    return results, ridge_infos

        # --- External or none mode: plain forecast() + optional manual Ridge ---
        point_forecast, quantile_forecast = self._model.forecast(
            horizon=horizon, inputs=inputs
        )
        forecast_nan = np.isnan(point_forecast[:, -horizon:])
        if forecast_nan.any():
            n_outlets_nan = int(forecast_nan.any(axis=1).sum())
            logger.warning(
                "timesfm: model returned NaN forecast for %d/%d outlets "
                "(horizon=%d, input_len=%d); replaced with 0",
                n_outlets_nan, len(batch), horizon,
                len(batch[0]["values"]),
            )
        n_backcast = point_forecast.shape[1] - horizon

        results = []
        ridge_infos = []
        for i, item in enumerate(batch):
            base_pred = point_forecast[i, -horizon:]
            base_lower = quantile_forecast[i, -horizon:, 1]
            base_upper = quantile_forecast[i, -horizon:, -1]
            base_all_q = quantile_forecast[i, -horizon:, 1:]

            backcast = point_forecast[i, :n_backcast]
            feature_names = sorted(item.get("feature_names", []))

            if covariate_handling == "external":
                adj, ridge_info = self._fit_ridge_for_persistence(
                    item["values"], backcast, item["hist_X"], item["fut_X"],
                    feature_names, horizon,
                )
            else:
                # covariate_handling == "none"
                adj = np.zeros(horizon)
                ridge_info = {"feature_names": [], "coefficients": [], "intercept": 0.0}

            ridge_infos.append(ridge_info)
            results.append((
                _sanitize_nan(base_pred + adj),
                _sanitize_nan(base_lower + adj),
                _sanitize_nan(base_upper + adj),
                _sanitize_nan(base_all_q + adj[:, np.newaxis]),
            ))

        return results, ridge_infos

    @staticmethod
    def _apply_weekday_profile_correction(
        predictions: np.ndarray,
        all_quantiles: np.ndarray,
        historical_data: list[dict],
        future_dates: list[date],
        strength: float = 1.0,
        threshold: float = 0.0,
        method: int = 1,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Redistribute forecast's weekly total to match historical weekday proportions.

        Computes each weekday's share of the weekly pattern from recent history
        (last 8 weeks), then adjusts the denormalized forecast so each weekday
        matches its historical share while preserving the overall weekly total.

        Must be called on denormalized values to avoid affine distortion from
        min-max normalization.

        Args:
            strength: Blending factor 0.0–1.0. 0 = no correction, 1 = full correction.
                      Applied as: effective_ratio = 1 + strength * (ratio - 1)
            threshold: Minimum absolute share divergence |ratio - 1| required before
                       correction is applied to a weekday. Days below threshold are
                       left unchanged.
            method: 1 = additive (shift quantiles by the same offset as the point
                    prediction, preserving the original spread); 2 = multiplicative
                    (scale all quantiles by the same ratio as the point prediction).

        Returns corrected (predictions, all_quantiles).
        """
        from collections import defaultdict

        # Use last 8 weeks of history for a stable but current profile
        recent = historical_data[-56:]

        # Historical mean per weekday (0=Mon..6=Sun)
        weekday_sums: dict[int, float] = defaultdict(float)
        weekday_counts: dict[int, int] = defaultdict(int)
        for record in recent:
            dow = record["date"].weekday()
            weekday_sums[dow] += record["value"]
            weekday_counts[dow] += 1

        hist_means: dict[int, float] = {}
        for dow in weekday_sums:
            if weekday_counts[dow] > 0:
                hist_means[dow] = weekday_sums[dow] / weekday_counts[dow]

        if not hist_means:
            return predictions, all_quantiles

        total_hist_mean = sum(hist_means.values())
        if total_hist_mean <= 0:
            return predictions, all_quantiles

        # Historical weekday shares (proportion each day contributes)
        hist_shares = {d: m / total_hist_mean for d, m in hist_means.items()}

        # Group forecast indices by weekday
        forecast_by_dow: dict[int, list[int]] = defaultdict(list)
        for i, fd in enumerate(future_dates):
            forecast_by_dow[fd.weekday()].append(i)

        # Forecast mean per weekday and shares
        forecast_means: dict[int, float] = {}
        for dow, indices in forecast_by_dow.items():
            forecast_means[dow] = float(np.mean(predictions[indices]))

        total_forecast_mean = sum(forecast_means.values())
        if total_forecast_mean <= 0:
            return predictions, all_quantiles

        forecast_shares = {d: m / total_forecast_mean for d, m in forecast_means.items()}

        # Apply ratio = hist_share / forecast_share with strength damping and threshold
        corrected_pred = predictions.copy()
        corrected_q = all_quantiles.copy()
        for dow, indices in forecast_by_dow.items():
            if dow not in hist_shares or forecast_shares.get(dow, 0) <= 0:
                continue
            raw_ratio = hist_shares[dow] / forecast_shares[dow]
            # Skip if divergence below threshold
            if abs(raw_ratio - 1.0) < threshold:
                continue
            # Dampen: blend between no-correction (1.0) and full correction (raw_ratio)
            ratio = 1.0 + strength * (raw_ratio - 1.0)
            for idx in indices:
                if method == 2:
                    # Multiplicative: scale everything by the ratio
                    corrected_pred[idx] *= ratio
                    corrected_q[idx] *= ratio
                else:
                    # Additive: shift quantiles by the same offset as the point
                    # prediction so the original spread is preserved.
                    offset = predictions[idx] * (ratio - 1.0)
                    corrected_pred[idx] += offset
                    corrected_q[idx] += offset

        return corrected_pred, corrected_q

    def _compute_economic_optimal(
        self,
        pred_date: date,
        day_index: int,
        all_quantiles: np.ndarray | None,
        covariates: dict[str, dict[date, float]] | None,
        holding_rate: float,
        protection_days: int,
        weekday_cvs: dict[int, float] | None = None,
        eo_methodology: int = 1,
        eo_extrapolation: int = 1,
    ) -> float | None:
        """Compute the Newsvendor-optimal draw for a single forecast day.

        Uses the critical fractile τ = Cu / (Cu + Co) to select the appropriate
        quantile from the full forecast distribution, where:
          - cost_per_unit   = production cost per unit (Co: wasted on unsold units)
          - profit_per_unit = selling price per unit
          - Cu              = selling_price − production_cost (margin lost per missed sale)
          - τ               = (profit − cost) / profit

        When weekday_cvs is provided, τ is adjusted upward for high-variation
        weekdays: adjusted_τ = τ + cv * (1 − τ), nudging toward higher quantiles
        to protect against stockout risk on volatile days.

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

        if weekday_cvs is not None:
            cv = min(weekday_cvs.get(pred_date.weekday(), 0.0), 1.0)
            tau = tau + cv * (1.0 - tau)

        return interpolate_quantile(
            tau, all_quantiles[day_index],
            methodology=eo_methodology, extrapolation=eo_extrapolation,
        )

    @staticmethod
    def _compute_weekday_cvs(
        historical_data: list[dict],
        history_days: int = 365,
    ) -> dict[int, float]:
        """Compute coefficient of variation per weekday from recent history.

        Returns dict mapping weekday (0=Mon..6=Sun) to CV (std/mean).
        CV is 0.0 when mean is zero or there are fewer than 2 samples.
        """
        from collections import defaultdict

        if not historical_data:
            return {}

        cutoff = historical_data[-1]["date"] - timedelta(days=history_days)
        recent = [
            r for r in historical_data if r["date"] > cutoff
        ]

        by_dow: dict[int, list[float]] = defaultdict(list)
        for r in recent:
            by_dow[r["date"].weekday()].append(float(r["value"]))

        cvs: dict[int, float] = {}
        for dow, vals in by_dow.items():
            if len(vals) < 2:
                cvs[dow] = 0.0
                continue
            arr = np.array(vals)
            mean = float(np.mean(arr))
            if mean <= 0:
                cvs[dow] = 0.0
                continue
            cvs[dow] = float(np.std(arr, ddof=1) / mean)
        return cvs

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
        """Load TimesFM 2.5 (200M PyTorch), using local cache when available.

        The upstream ``_from_pretrained`` hardcodes ``force_download=True``,
        which re-downloads the model on every call.  We bypass this by using
        ``huggingface_hub.hf_hub_download`` with ``force_download=False`` to
        get the cached checkpoint, then loading weights directly.
        """
        if self._model_loaded:
            return
        self._apply_hf_env()
        # TimesFM's compiled_decode uses Triton kernels that may not support
        # newer GPU architectures (e.g. Blackwell sm_120).  Disable torch.compile
        # only when running on an unsupported architecture.
        try:
            import torch
            if torch.cuda.is_available() and torch.cuda.get_device_capability(0)[0] >= 12:
                os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")
                logger.info("Disabled torch.compile (Blackwell GPU detected)")
        except Exception:
            pass
        try:
            import timesfm
            from huggingface_hub import hf_hub_download

            repo_id = "google/timesfm-2.5-200m-pytorch"

            # Download only if not already cached
            logger.info("Downloading/resolving model from Hugging Face: %s", repo_id)
            model_path = hf_hub_download(
                repo_id=repo_id,
                filename="model.safetensors",
                force_download=False,
            )
            logger.info("Model resolved at: %s", model_path)

            # Bypass from_pretrained() which hardcodes force_download=True
            # and re-downloads on every call. Instead, instantiate the wrapper
            # and load the checkpoint directly.
            self._model = timesfm.TimesFM_2p5_200M_torch()
            self._model.model.load_checkpoint(model_path)
            self._compile_for_context(1024)
            logger.info("TimesFM 2.5 model loaded successfully")
        except Exception as e:
            if not self.allow_fallback:
                raise RuntimeError(f"TimesFM model failed to load and engine fallback is disabled") from e
            logger.warning(f"Failed to load TimesFM model, falling back to stub: {e}")
            self._model = None
        finally:
            self._model_loaded = True

    def _compile_for_context(self, max_context: int) -> None:
        """(Re)compile the model for a specific max_context size.

        TimesFM's masking is broken when data length < max_context (zero-padded
        positions produce NaN).  To avoid this we recompile before each batch
        with a max_context that matches the data, rounded up to the patch size.
        Compilation is cheap — it only creates a closure, no torch.compile.
        """
        import timesfm

        patch_size = self._model.model.p  # 32 for 200M
        # Round up to nearest patch_size multiple
        max_context = max(
            ((max_context + patch_size - 1) // patch_size) * patch_size,
            patch_size,
        )
        if getattr(self, "_compiled_context", None) == max_context:
            return  # already compiled for this size
        self._model.compile(
            timesfm.ForecastConfig(
                max_context=max_context,
                max_horizon=128,
                normalize_inputs=True,
                use_continuous_quantile_head=True,
                force_flip_invariance=True,
                infer_is_positive=True,
                fix_quantile_crossing=True,
                return_backcast=True,
            )
        )
        self._compiled_context = max_context

    def _build_covariate_arrays(
        self,
        df: pd.DataFrame,
        prediction_from: date,
        horizon: int,
        covariates: dict[str, dict[date, float]] | None = None,
        pad_dates: dict[str, set[date]] | None = None,
        weekday_correction: list[bool] | None = None,
        active_covariate_types: set[int] | None = None,
    ) -> dict[str, list[float]]:
        """Build full covariate sequences covering historical context + future horizon.

        Includes weekday one-hot features for each enabled day (dow_1=Mon .. dow_7=Sun).
        Financial covariates (date-keyed) and pad event indicators (date-keyed binary)
        are added when provided.

        Args:
            df: Preprocessed historical DataFrame with 'date' column (pd.Timestamps)
            prediction_from: First date of the prediction window
            horizon: Number of future periods
            covariates: Optional feature name → {date: value} (fully resolved per date)
            pad_dates: Optional pad name → set of specific event dates (binary indicator)
            weekday_correction: Optional list of 7 bools [Mon..Sun]; True = include that
                day's one-hot feature. None defaults to all True.
            active_covariate_types: Optional set of enabled covariate type IDs
                (1=Weekday, 2=Financial, 3=PAD). None means all enabled.

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

        # Weekday one-hot encoding (dow_1=Mon .. dow_7=Sun); each day is optional.
        # Enabled days get an explicit feature; disabled days are not corrected.
        if active_covariate_types is None or 1 in active_covariate_types:
            flags = weekday_correction if weekday_correction is not None else [True] * 7
            for dow in range(1, 8):
                if flags[dow - 1]:
                    result[f"dow_{dow}"] = [1.0 if wd == dow else 0.0 for wd in all_weekdays]

        # Financial covariates keyed by date — profit_per_unit is excluded because
        # it reflects margin, not end-user price, and does not influence demand.
        _EXCLUDED_COVARIATES = {"cost_per_unit", "profit_per_unit"}
        if covariates and (active_covariate_types is None or 2 in active_covariate_types):
            for feature, date_map in covariates.items():
                if feature not in _EXCLUDED_COVARIATES:
                    result[feature] = [float(date_map.get(d, 0.0)) for d in all_dates]

        # Pad event indicators — binary 1.0 on event dates, 0.0 otherwise
        # Ridge learns the per-outlet effect magnitude from historical occurrences
        if pad_dates and (active_covariate_types is None or 3 in active_covariate_types):
            for pad_name, event_dates in pad_dates.items():
                result[pad_name] = [1.0 if d in event_dates else 0.0 for d in all_dates]

        return result

    async def _run_inference(
        self,
        values: np.ndarray,
        horizon: int,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Run plain inference (no covariates). Offloaded to thread pool."""
        self._compile_for_context(len(values))
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
        covariate_handling: str = "external",
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Run inference with dynamic numerical covariates. Offloaded to thread pool.

        Supports three modes via covariate_handling:
        - "native": delegates to TimesFM's forecast_with_covariates() API
        - "external": manual Ridge regression on residuals (original behavior)
        - "none": plain forecast with no covariate adjustment

        Returns:
            Tuple of (predictions, lower, upper, all_quantiles) where all_quantiles has
            shape (horizon, n_quantiles) with quantile levels P10..P90 (see _QUANTILE_LEVELS).
        """
        loop = asyncio.get_event_loop()

        def _infer():
            n_hist = len(values)
            feature_names = sorted(cov_arrays.keys())
            if feature_names:
                hist_X = np.column_stack([cov_arrays[f][:n_hist] for f in feature_names])
                fut_X = np.column_stack([cov_arrays[f][n_hist:] for f in feature_names])
            else:
                hist_X = np.empty((n_hist, 0))
                fut_X = np.empty((horizon, 0))

            self._compile_for_context(n_hist)

            mode = covariate_handling

            # --- Native mode ---
            if mode == "native" and feature_names:
                dyn_num_covs = {name: [cov_arrays[name]] for name in feature_names}
                try:
                    point_forecast, quantile_forecast = self._model.forecast_with_covariates(
                        inputs=[values],
                        dynamic_numerical_covariates=dyn_num_covs,
                        xreg_mode="xreg + timesfm",
                        ridge=1.0,
                        normalize_xreg_target_per_input=True,
                    )
                except Exception:
                    logger.warning(
                        "timesfm: forecast_with_covariates failed, falling back to external Ridge",
                        exc_info=True,
                    )
                    mode = "external"
                else:
                    return (
                        _sanitize_nan(point_forecast[0, -horizon:]),
                        _sanitize_nan(quantile_forecast[0, -horizon:, 1]),
                        _sanitize_nan(quantile_forecast[0, -horizon:, -1]),
                        _sanitize_nan(quantile_forecast[0, -horizon:, 1:]),
                    )

            # --- External or none mode ---
            point_forecast, quantile_forecast = self._model.forecast(
                horizon=horizon, inputs=[values]
            )
            base_pred = point_forecast[0, -horizon:]
            base_lower = quantile_forecast[0, -horizon:, 1]
            base_upper = quantile_forecast[0, -horizon:, -1]
            base_all_quantiles = quantile_forecast[0, -horizon:, 1:]

            if mode == "external" and feature_names:
                n_backcast = point_forecast.shape[1] - horizon
                backcast = point_forecast[0, :n_backcast]
                adj, _ = self._fit_ridge_for_persistence(
                    values, backcast, hist_X, fut_X, feature_names, horizon,
                )
            else:
                adj = np.zeros(horizon)

            return (
                _sanitize_nan(base_pred + adj),
                _sanitize_nan(base_lower + adj),
                _sanitize_nan(base_upper + adj),
                _sanitize_nan(base_all_quantiles + adj[:, np.newaxis]),
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
