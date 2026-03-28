"""Direct Chronos 2.0 prediction engine (no AutoGluon wrapper).

Loads the Chronos model once via the chronos-forecasting library and reuses it
across all prediction calls, avoiding the per-batch model reload that the
AutoGluon-based engine suffers from.  Covariates are handled via Ridge
regression on residuals (same approach as TimesFM).
"""

import asyncio
import logging
from datetime import date, timedelta

import numpy as np
import pandas as pd

from gorm_ai.prediction.engine import EngineCapabilities, PredictionEngine, interpolate_quantile
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

# Outlets per forward pass.  T5-based Chronos uses autoregressive sampling
# which is far more memory-intensive than Bolt's single forward pass.
BATCH_SIZE = 8

# Number of Monte-Carlo sample paths drawn per context.  T5 autoregressive
# decoding allocates KV-cache per sample — 20 is enough for stable P10–P90
# quantiles while keeping memory manageable.
NUM_SAMPLES = 20

# HuggingFace model ID.  chronos-t5-small (46M params, ~180MB in float32)
# is the best trade-off for memory-constrained environments.
# Alternatives: chronos-t5-tiny (8M), chronos-t5-base (200M), chronos-t5-large (710M).
DEFAULT_MODEL_ID = "amazon/chronos-t5-small"

_CHRONOS_AVAILABLE: bool | None = None


class Chronos2DirectEngine(PredictionEngine):
    """Direct Chronos 2.0 engine — load once, predict many.

    Uses the ``chronos-forecasting`` library directly instead of AutoGluon's
    ``TimeSeriesPredictor``.  The model is loaded lazily on first prediction and
    cached on the instance for the lifetime of the Celery worker process.

    Covariates (weekday dummies, financials, PAD events) are incorporated via
    Ridge regression on residuals, identical to the TimesFM approach.
    """

    _VALID_PRECISIONS = {"float32", "bfloat16", "float16"}

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        self._model_id = model_id
        self._pipeline = None
        self._model_loaded = False
        self._last_ridge_results: list[dict] | None = None
        self._num_samples: int = NUM_SAMPLES
        self._batch_size: int = BATCH_SIZE
        self._precision: str = "bfloat16"

    # Maps short model names (as stored in DB) to full HuggingFace model IDs.
    _MODEL_ALIASES: dict[str, str] = {
        "chronos-t5-tiny": "amazon/chronos-t5-tiny",
        "chronos-t5-mini": "amazon/chronos-t5-mini",
        "chronos-t5-small": "amazon/chronos-t5-small",
        "chronos-t5-base": "amazon/chronos-t5-base",
        "chronos-t5-large": "amazon/chronos-t5-large",
        "chronos-bolt-tiny": "amazon/chronos-bolt-tiny",
        "chronos-bolt-mini": "amazon/chronos-bolt-mini",
        "chronos-bolt-small": "amazon/chronos-bolt-small",
        "chronos-bolt-base": "amazon/chronos-bolt-base",
    }

    def _resolve_model_id(self, value: str) -> str:
        """Resolve a DB parameter value to a HuggingFace model ID.

        Handles formats like:
          "amazon/chronos-t5-tiny"       → passed through
          "chronos-t5-tiny"              → "amazon/chronos-t5-tiny"
          "chronos-t5-tiny (8M)"         → "amazon/chronos-t5-tiny"
        """
        # Strip parenthetical suffix: "chronos-t5-tiny (8M)" → "chronos-t5-tiny"
        name = value.split("(")[0].strip()
        if "/" in name:
            return name
        return self._MODEL_ALIASES.get(name, f"amazon/{name}")

    def apply_parameters(self, params: dict[str, str]) -> None:
        """Apply DB-driven parameters before the first prediction.

        Supported parameter names:
          model / submodel – HuggingFace model ID or short name
          samples          – number of Monte-Carlo sample paths (int)
          precision        – torch dtype: float32 | bfloat16 | float16
          batch_size       – outlets per forward pass (int)
        """
        model_value = params.get("model") or params.get("submodel")
        if model_value:
            self._model_id = self._resolve_model_id(model_value)
        if "samples" in params:
            self._num_samples = int(params["samples"])
        if "precision" in params:
            p = params["precision"]
            if p in self._VALID_PRECISIONS:
                self._precision = p
            else:
                logger.warning("Ignoring unknown precision '%s'; valid: %s", p, self._VALID_PRECISIONS)
        if "batch_size" in params:
            self._batch_size = int(params["batch_size"])

    # -- capabilities --------------------------------------------------------

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Chronos 2.0",
            description="Amazon Chronos 2.0 foundation model (direct, no AutoGluon)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=2048,
            max_horizon=64,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def get_actual_slug(self) -> str | None:
        if self._model_loaded and self._pipeline is None:
            return "statistical"
        return None

    # -- model loading -------------------------------------------------------

    def _check_chronos(self) -> bool:
        global _CHRONOS_AVAILABLE
        if _CHRONOS_AVAILABLE is None:
            try:
                import chronos  # noqa: F401
                _CHRONOS_AVAILABLE = True
                logger.info("chronos-forecasting is available")
            except ImportError:
                _CHRONOS_AVAILABLE = False
                logger.warning("chronos-forecasting not installed; falling back to statistical")
        return _CHRONOS_AVAILABLE

    def _apply_hf_env(self) -> None:
        """Push HF_TOKEN / HF_HUB_CACHE into os.environ for huggingface_hub."""
        import os
        from gorm_ai.config import get_settings

        s = get_settings()
        if s.hf_token:
            os.environ.setdefault("HF_TOKEN", s.hf_token)
        if s.hf_hub_cache:
            abs_cache = os.path.abspath(s.hf_hub_cache)
            os.environ.setdefault("HF_HUB_CACHE", abs_cache)

    def _load_model(self) -> None:
        """Load the Chronos pipeline once and cache it."""
        if self._model_loaded:
            return
        if not self._check_chronos():
            self._model_loaded = True
            return
        self._apply_hf_env()
        try:
            import torch
            from chronos import BaseChronosPipeline

            dtype_map = {
                "float32": torch.float32,
                "bfloat16": torch.bfloat16,
                "float16": torch.float16,
            }
            device = "cuda" if torch.cuda.is_available() else "cpu"
            self._pipeline = BaseChronosPipeline.from_pretrained(
                self._model_id,
                device_map=device,
                dtype=dtype_map[self._precision],
            )
            logger.info(
                "Chronos model loaded: %s (pipeline: %s, device: %s)",
                self._model_id, type(self._pipeline).__name__, device,
            )
        except Exception as e:
            logger.warning("Failed to load Chronos model, falling back to statistical: %s", e)
            self._pipeline = None
        finally:
            self._model_loaded = True

    # -- single-outlet predict -----------------------------------------------

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
        self.validate_input(historical_data, horizon)
        item = {
            "historical_data": historical_data,
            "covariates": covariates,
            "pad_dates": pad_dates,
            "weekday_correction": kwargs.get("weekday_correction"),
            "weekday_profile_correction": kwargs.get("weekday_profile_correction"),
        }
        results = await self.predict_batch(
            [item], horizon, prediction_from,
            holding_rate=holding_rate, protection_days=protection_days,
        )
        return results[0]

    # -- batch predict -------------------------------------------------------

    async def predict_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from: date,
        batch_size: int = BATCH_SIZE,
        holding_rate: float = 0.25,
        protection_days: int = 7,
    ) -> list[list[PredictionResult]]:
        if not items:
            return []

        # Use DB-configured batch size when caller uses the default.
        if batch_size == BATCH_SIZE:
            batch_size = self._batch_size

        if not self._model_loaded:
            self._load_model()

        if self._pipeline is None:
            from gorm_ai.prediction.engines.statistical import StatisticalEngine
            fallback = StatisticalEngine()
            return await fallback.predict_batch(items, horizon, prediction_from, batch_size)

        # Preprocess each outlet (own DataPreprocessor for stateful min/max).
        prepared: list[dict] = []
        for item in items:
            pp = DataPreprocessor(fill_missing=True, normalize=True)
            df = pp.preprocess(item["historical_data"])
            values = df["value"].values
            cov_arrays = self._build_covariate_arrays(
                df, prediction_from, horizon,
                item.get("covariates"), item.get("pad_dates"),
                item.get("weekday_correction"),
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
                "feature_names": feature_names,
                "preprocessor": pp,
                "covariates": item.get("covariates"),
            })

        # Sort by history length to minimise padding waste.
        order = sorted(range(len(prepared)), key=lambda i: len(prepared[i]["values"]))
        sorted_prepared = [prepared[i] for i in order]

        # Run batches and collect normalised results.
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

    # -- batch inference (sync, runs in thread pool) -------------------------

    def _run_batch_inference(
        self,
        batch: list[dict],
        horizon: int,
    ) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], list[dict]]:
        """Single Chronos forward pass for a batch + per-outlet Ridge regression.

        Handles both pipeline types:
          - ChronosBoltPipeline: returns quantiles directly (batch, num_quantiles, horizon)
          - ChronosPipeline: returns sample paths (batch, num_samples, horizon)

        Returns:
          - list of (predictions, lower, upper, all_quantiles) tuples (normalised)
          - list of ridge_info dicts
        """
        import torch
        from chronos import ChronosBoltPipeline
        from sklearn.linear_model import Ridge

        is_bolt = isinstance(self._pipeline, ChronosBoltPipeline)

        # Build batch context tensor — pad shorter series on the left with zeros.
        max_len = max(len(item["values"]) for item in batch)
        contexts = []
        for item in batch:
            v = item["values"]
            if len(v) < max_len:
                v = np.concatenate([np.zeros(max_len - len(v)), v])
            contexts.append(torch.tensor(v, dtype=torch.float32))
        context_tensor = torch.stack(contexts)  # (batch_size, max_len)

        with torch.no_grad():
            if is_bolt:
                # Bolt: returns (batch, num_quantiles, horizon) — quantiles directly
                forecast = self._pipeline.predict(
                    context_tensor, prediction_length=horizon,
                )
            else:
                # Original Chronos: returns (batch, num_samples, horizon) — sample paths
                forecast = self._pipeline.predict(
                    context_tensor, prediction_length=horizon, num_samples=self._num_samples,
                )
        forecast_np = forecast.numpy()

        results = []
        ridge_infos = []
        for i, item in enumerate(batch):
            values = item["values"]
            hist_X = item["hist_X"]
            fut_X = item["fut_X"]

            if is_bolt:
                # Bolt output shape: (batch, 9, horizon) for P10..P90
                # Transpose to (horizon, 9) to match our convention
                base_quantiles = forecast_np[i].T  # (horizon, num_quantiles)
                base_pred = base_quantiles[:, 4]    # P50 (median) as point forecast
            else:
                # Sample output shape: (batch, num_samples, horizon)
                outlet_samples = forecast_np[i]  # (num_samples, horizon)
                base_pred = np.median(outlet_samples, axis=0)
                base_quantiles = np.quantile(
                    outlet_samples, _QUANTILE_LEVELS, axis=0
                ).T  # (horizon, num_quantiles)

            base_lower = base_quantiles[:, 0]   # P10
            base_upper = base_quantiles[:, -1]  # P90

            # Ridge regression on residuals for covariate adjustment.
            # Since Chronos doesn't provide a backcast, we approximate residuals
            # using the tail of history vs the model's implicit level.
            n_hist = len(values)
            align_len = min(n_hist, horizon)
            forecast_level = float(base_pred[0])
            residuals = values[-align_len:] - forecast_level
            hist_X_aligned = hist_X[-align_len:]

            feature_names = sorted(item.get("feature_names", []))
            if feature_names:
                ridge = Ridge(alpha=1.0, fit_intercept=True)
                ridge.fit(hist_X_aligned, residuals)
                adj = ridge.predict(fut_X)
            else:
                adj = np.zeros(horizon)

            ridge_infos.append({
                "feature_names": feature_names,
                "coefficients": list(ridge.coef_) if feature_names else [],
                "intercept": float(ridge.intercept_) if feature_names else 0.0,
            })

            results.append((
                _sanitize_nan(base_pred + adj),
                _sanitize_nan(base_lower + adj),
                _sanitize_nan(base_upper + adj),
                _sanitize_nan(base_quantiles + adj[:, np.newaxis]),
            ))

        return results, ridge_infos

    # -- covariates ----------------------------------------------------------

    @staticmethod
    def _build_covariate_arrays(
        df: pd.DataFrame,
        prediction_from: date,
        horizon: int,
        covariates: dict[str, dict[date, float]] | None = None,
        pad_dates: dict[str, set[date]] | None = None,
        weekday_correction: list[bool] | None = None,
    ) -> dict[str, list[float]]:
        """Build covariate sequences (historical + future) for Ridge regression."""
        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)
        historical_dates = [ts.date() for ts in df["date"]]
        all_dates = historical_dates + list(future_dates)
        all_weekdays = [d.weekday() + 1 for d in all_dates]  # 1=Mon .. 7=Sun

        result: dict[str, list[float]] = {}

        # Weekday one-hot
        flags = weekday_correction if weekday_correction is not None else [True] * 7
        for dow in range(1, 8):
            if flags[dow - 1]:
                result[f"dow_{dow}"] = [1.0 if wd == dow else 0.0 for wd in all_weekdays]

        # Financial covariates (exclude profit_per_unit — margin, not demand driver)
        _EXCLUDED = {"profit_per_unit"}
        if covariates:
            for feature, date_map in covariates.items():
                if feature not in _EXCLUDED:
                    result[feature] = [float(date_map.get(d, 0.0)) for d in all_dates]

        # PAD event indicators
        if pad_dates:
            for pad_name, event_dates in pad_dates.items():
                result[pad_name] = [1.0 if d in event_dates else 0.0 for d in all_dates]

        return result

    # -- weekday profile correction ------------------------------------------

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
        """Redistribute weekly total to match historical weekday proportions.

        Args:
            method: 1 = additive (shift quantiles by same offset as point prediction,
                    preserving spread); 2 = multiplicative (scale everything by ratio).
        """
        from collections import defaultdict

        recent = historical_data[-56:]

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

        hist_shares = {d: m / total_hist_mean for d, m in hist_means.items()}

        forecast_by_dow: dict[int, list[int]] = defaultdict(list)
        for i, fd in enumerate(future_dates):
            forecast_by_dow[fd.weekday()].append(i)

        forecast_means: dict[int, float] = {}
        for dow, indices in forecast_by_dow.items():
            forecast_means[dow] = float(np.mean(predictions[indices]))

        total_forecast_mean = sum(forecast_means.values())
        if total_forecast_mean <= 0:
            return predictions, all_quantiles

        forecast_shares = {d: m / total_forecast_mean for d, m in forecast_means.items()}

        corrected_pred = predictions.copy()
        corrected_q = all_quantiles.copy()
        for dow, indices in forecast_by_dow.items():
            if dow not in hist_shares or forecast_shares.get(dow, 0) <= 0:
                continue
            raw_ratio = hist_shares[dow] / forecast_shares[dow]
            if abs(raw_ratio - 1.0) < threshold:
                continue
            ratio = 1.0 + strength * (raw_ratio - 1.0)
            for idx in indices:
                if method == 2:
                    corrected_pred[idx] *= ratio
                    corrected_q[idx] *= ratio
                else:
                    offset = predictions[idx] * (ratio - 1.0)
                    corrected_pred[idx] += offset
                    corrected_q[idx] += offset

        return corrected_pred, corrected_q

    # -- economic optimal ----------------------------------------------------

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
        """Newsvendor-optimal draw using critical fractile.

        When weekday_cvs is provided, τ is adjusted upward for
        high-variation weekdays to protect against stockouts.
        """
        if all_quantiles is None or covariates is None:
            return None
        selling_price = covariates.get("profit_per_unit", {}).get(pred_date, 0.0)
        production_cost = covariates.get("cost_per_unit", {}).get(pred_date, 0.0)
        if selling_price <= 0 or production_cost <= 0 or selling_price <= production_cost:
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
        """Compute coefficient of variation per weekday from recent history."""
        from collections import defaultdict

        if not historical_data:
            return {}

        cutoff = historical_data[-1]["date"] - timedelta(days=history_days)
        recent = [r for r in historical_data if r["date"] > cutoff]

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
