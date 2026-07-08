"""Kairos prediction engine (ShanghaiTech University).

Uses the Kairos foundation model via the ``tsfm`` package (installed from the
Kairos GitHub repo — NOT the unrelated PyPI ``tsfm`` bioinformatics package).

Kairos is a T5-style encoder-decoder transformer (50M params) with
Mixture-of-Size Dynamic Patching and Instance-adaptive Rotary Position
Embedding.  It outputs quantile forecasts directly.

Covariates are handled via Ridge regression on residuals when
covariate_handling is "external" or "native" (no native API, so both
use Ridge).  When "none", covariates are skipped entirely.
"""

import asyncio
import logging
from collections import defaultdict
from datetime import date, timedelta

import numpy as np
import pandas as pd

from crypto_ai.prediction.engine import (
    EngineCapabilities,
    MemoryEstimate,
    PredictionEngine,
    interpolate_quantile,
)
from crypto_ai.prediction.engines.chronos_pipeline_engine import _sanitize_nan
from crypto_ai.prediction.preprocessor import DataPreprocessor
from crypto_ai.schemas.prediction import PredictionResult

logger = logging.getLogger(__name__)

_QUANTILE_LEVELS = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])

BATCH_SIZE = 8
MAX_CONTEXT = 2048
MAX_HORIZON = 720

DEFAULT_MODEL_ID = "mldi-lab/Kairos_50m"

_KAIROS_AVAILABLE: bool | None = None


class KairosEngine(PredictionEngine):
    """Kairos foundation model engine — load once, predict many.

    ShanghaiTech Kairos (50M params, pre-trained on 300B+ time points) is a
    T5-style encoder-decoder that outputs quantile forecasts directly via its
    multi-patch parallel decoder.

    Works on both CPU and GPU.

    Covariates (weekday dummies, financials, PAD events) are incorporated via
    Ridge regression on residuals when covariate_handling is "external" or
    "native".  When "none", covariates are skipped entirely.
    """

    _VALID_PRECISIONS = {"float32"}

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        self._model_id = model_id
        self._model = None
        self._model_loaded = False
        self._last_ridge_results: list[dict] | None = None
        self._batch_size: int = BATCH_SIZE
        self._precision: str = "float32"

    _MODEL_ALIASES: dict[str, str] = {
        "kairos-50m": "mldi-lab/Kairos_50m",
        "kairos-23m": "mldi-lab/Kairos_23m",
        "kairos-10m": "mldi-lab/Kairos_10m",
    }

    def _resolve_model_id(self, value: str) -> str:
        name = value.split("(")[0].strip()
        if "/" in name:
            return name
        return self._MODEL_ALIASES.get(name.lower(), f"mldi-lab/{name}")

    def apply_parameters(self, params: dict[str, str]) -> None:
        """Apply DB-driven parameters before the first prediction.

        Supported parameter names:
          model / submodel – HuggingFace model ID or short name
          precision        – torch dtype: float32 | bfloat16 | float16
          batch_size       – outlets per forward pass (int)
        """
        model_value = params.get("model") or params.get("submodel")
        if model_value:
            self._model_id = self._resolve_model_id(model_value)
        if "precision" in params:
            p = params["precision"]
            if p in self._VALID_PRECISIONS:
                self._precision = p
            else:
                logger.warning(
                    "Ignoring unknown precision '%s'; valid: %s", p, self._VALID_PRECISIONS
                )
        if "batch_size" in params:
            self._batch_size = int(params["batch_size"])

    # -- capabilities --------------------------------------------------------

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Kairos",
            description="ShanghaiTech Kairos foundation model — 50M params, quantile output",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=16,
            max_history_length=MAX_CONTEXT,
            max_horizon=MAX_HORIZON,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def estimate_memory(self, *, task_type: str = "prediction", num_outlets: int = 1,
                        batch_size: int = 8, horizon: int = 30, context_length: int = 512,
                        num_covariates: int = 0, precision: str = "float32",
                        epochs: int = 0) -> MemoryEstimate:
        # Kairos: 50M params T5-style, outputs quantiles directly
        bytes_per_param = 2 if precision in ("bfloat16", "float16") else 4
        model_mb = 50e6 * bytes_per_param / (1024 * 1024)
        effective_batch = min(batch_size or self._batch_size, num_outlets)
        context_mb = effective_batch * min(context_length, MAX_CONTEXT) * 4 / (1024 * 1024)
        output_mb = effective_batch * horizon * 9 * 4 / (1024 * 1024)
        ridge_mb = effective_batch * context_length * max(num_covariates, 1) * 8 / (1024 * 1024)
        inference_mb = context_mb + output_mb + ridge_mb + 150

        multiplier = {"simulation": 1.3, "finetune": 4.0}.get(task_type, 1.0)
        total = model_mb + inference_mb * multiplier
        return MemoryEstimate(
            model_mb=round(model_mb, 1), inference_mb=round(inference_mb * multiplier, 1),
            total_mb=round(total, 1), gpu_required=False, task_type=task_type,
        )

    def get_actual_slug(self) -> str | None:
        if self._model_loaded and self._model is None:
            return "statistical"
        return None

    # -- model loading -------------------------------------------------------

    def is_available(self) -> bool:
        return self._check_kairos()

    def _check_kairos(self) -> bool:
        global _KAIROS_AVAILABLE
        if _KAIROS_AVAILABLE is None:
            try:
                from tsfm.model.kairos import AutoModel  # noqa: F401

                _KAIROS_AVAILABLE = True
                logger.info("tsfm (Kairos) is available")
            except ImportError:
                _KAIROS_AVAILABLE = False
                logger.warning(
                    "tsfm (Kairos) not installed; falling back to statistical. "
                    "Install via: pip install git+https://github.com/foundation-model-research/Kairos"
                )
        return _KAIROS_AVAILABLE

    def _apply_hf_env(self) -> None:
        """Push HF_TOKEN / HF_HUB_CACHE into os.environ for huggingface_hub."""
        import os

        from crypto_ai.config import get_settings

        s = get_settings()
        if s.hf_token:
            os.environ.setdefault("HF_TOKEN", s.hf_token)
        if s.hf_hub_cache:
            abs_cache = os.path.abspath(s.hf_hub_cache)
            os.environ.setdefault("HF_HUB_CACHE", abs_cache)

    def _load_model(self) -> None:
        """Load the Kairos model once and cache it."""
        if self._model_loaded:
            return
        if not self._check_kairos():
            self._model_loaded = True
            return
        self._apply_hf_env()
        try:
            import torch
            from tsfm.model.kairos import AutoModel

            dtype_map = {
                "float32": torch.float32,
                "bfloat16": torch.bfloat16,
                "float16": torch.float16,
            }
            logger.info("Downloading/resolving model from Hugging Face: %s", self._model_id)
            self._model = AutoModel.from_pretrained(
                self._model_id,
                trust_remote_code=True,
            )
            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            self._dtype = dtype_map[self._precision]
            if self._dtype != torch.float32:
                try:
                    self._model = self._model.to(self._dtype)
                except RuntimeError as exc:
                    logger.warning(
                        "Kairos model does not support %s (%s); falling back to float32",
                        self._precision, exc,
                    )
                    self._dtype = torch.float32
                    self._precision = "float32"
            self._model.to(self._device)
            self._model.eval()
            logger.info(
                "Kairos model loaded: %s (%s, device: %s)",
                self._model_id, self._precision, self._device,
            )
        except Exception as e:
            logger.warning("Failed to load Kairos model, falling back to statistical: %s", e)
            self._model = None
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

        if batch_size == BATCH_SIZE:
            batch_size = self._batch_size

        if not self._model_loaded:
            self._load_model()

        requested_horizon = horizon
        horizon = self._resolve_horizon(horizon)

        if self._model is None:
            if not self.allow_fallback:
                raise RuntimeError("Kairos model failed to load and engine fallback is disabled")
            from crypto_ai.prediction.engines.statistical import StatisticalEngine

            fallback = StatisticalEngine()
            return await fallback.predict_batch(items, horizon, prediction_from, batch_size)

        # Preprocess each outlet.
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
                "feature_names": feature_names,
                "preprocessor": pp,
                "covariates": item.get("covariates"),
                "covariate_handling": item.get("covariate_handling", "external"),
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
            # Sanitize NaN like the TimesFM/Chronos engines: a NaN forward
            # pass otherwise propagates into stored predictions and metrics.
            preds = _sanitize_nan(pp.denormalize(preds_norm))
            lower = _sanitize_nan(pp.denormalize(lower_norm))
            upper = _sanitize_nan(pp.denormalize(upper_norm))
            quantiles = _sanitize_nan(pp.denormalize(quantiles_norm))

            # PAD adjustment — applied per-date, not via Ridge
            pad_adj = self.compute_pad_adjustments(
                item["historical_data"],
                future_dates,
                item.get("pad_dates"),
                active_covariate_types=item.get("active_covariate_types"),
                baseline_window_days=item.get("pad_baseline_window_days", 56),
                history_days=item.get("pad_history_days", 730),
            )
            if pad_adj.any():
                preds = preds + pad_adj
                lower = lower + pad_adj
                upper = upper + pad_adj
                quantiles = quantiles + pad_adj[:, np.newaxis]

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

        if horizon != requested_horizon:
            output = [r[:requested_horizon] for r in output]
        return output

    # -- batch inference (sync, runs in thread pool) -------------------------

    def _run_batch_inference(
        self,
        batch: list[dict],
        horizon: int,
    ) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], list[dict]]:
        """Single Kairos forward pass for a batch + per-outlet Ridge regression.

        Kairos output shape: (batch, num_quantiles, horizon).
        We select the 9 standard quantile levels (P10–P90) from the output.

        Returns:
          - list of (predictions, lower, upper, all_quantiles) tuples (normalised)
          - list of ridge_info dicts
        """
        import torch
        from sklearn.linear_model import Ridge

        # Build batch context tensor — pad shorter series on the left with zeros.
        max_len = min(max(len(item["values"]) for item in batch), MAX_CONTEXT)
        contexts = []
        for item in batch:
            v = item["values"]
            if len(v) > max_len:
                v = v[-max_len:]
            if len(v) < max_len:
                v = np.concatenate([np.zeros(max_len - len(v)), v])
            contexts.append(v)

        context_tensor = torch.tensor(
            np.stack(contexts), dtype=self._dtype
        ).to(self._device)  # (batch_size, max_len)

        with torch.no_grad():
            try:
                forecast = self._model(
                    past_target=context_tensor,
                    prediction_length=horizon,
                    generation=True,
                    preserve_positivity=True,
                    average_with_flipped_input=True,
                )
            except RuntimeError as exc:
                if self._dtype != torch.float32 and "half precision" in str(exc):
                    logger.warning(
                        "Kairos forward pass failed in %s (%s); retrying in float32",
                        self._precision, exc,
                    )
                    self._dtype = torch.float32
                    self._precision = "float32"
                    self._model = self._model.float()
                    context_tensor = context_tensor.float()
                    forecast = self._model(
                        past_target=context_tensor,
                        prediction_length=horizon,
                        generation=True,
                        preserve_positivity=True,
                        average_with_flipped_input=True,
                    )
                else:
                    raise
        # prediction_outputs shape: (batch, num_quantiles, horizon)
        raw_output = forecast["prediction_outputs"].cpu().float().numpy()

        # Kairos outputs num_quantiles quantile levels.  If it matches our
        # standard 9, use directly; otherwise pick the closest indices.
        n_q = raw_output.shape[1]
        if n_q == 9:
            # Already P10–P90 — transpose to (batch, horizon, 9)
            forecast_quantiles = raw_output.transpose(0, 2, 1)
        else:
            # Model outputs n_q evenly-spaced quantiles — pick closest to our levels.
            model_levels = np.linspace(0, 1, n_q + 2)[1:-1]  # exclude 0 and 1
            target_indices = [
                int(np.argmin(np.abs(model_levels - q))) for q in _QUANTILE_LEVELS
            ]
            forecast_quantiles = raw_output[:, target_indices, :].transpose(0, 2, 1)

        results = []
        ridge_infos = []
        for i, item in enumerate(batch):
            values = item["values"]
            hist_X = item["hist_X"]
            fut_X = item["fut_X"]

            base_quantiles = forecast_quantiles[i]  # (horizon, 9)
            base_pred = base_quantiles[:, 4]  # P50 (median) as point forecast
            base_lower = base_quantiles[:, 0]   # P10
            base_upper = base_quantiles[:, -1]  # P90

            # Ridge regression on residuals for covariate adjustment.
            covariate_handling = item.get("covariate_handling", "external")
            feature_names = sorted(item.get("feature_names", []))
            if covariate_handling != "none" and feature_names:
                n_hist = len(values)
                align_len = min(n_hist, horizon)
                forecast_level = float(base_pred[0])
                residuals = values[-align_len:] - forecast_level
                hist_X_aligned = hist_X[-align_len:]
                ridge = Ridge(alpha=1.0, fit_intercept=True)
                ridge.fit(hist_X_aligned, residuals)
                adj = ridge.predict(fut_X)
            else:
                adj = np.zeros(horizon)

            used_ridge = covariate_handling != "none" and feature_names
            ridge_infos.append({
                "feature_names": feature_names if used_ridge else [],
                "coefficients": list(ridge.coef_) if used_ridge else [],
                "intercept": float(ridge.intercept_) if used_ridge else 0.0,
            })

            results.append((
                base_pred + adj,
                base_lower + adj,
                base_upper + adj,
                base_quantiles + adj[:, np.newaxis],
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
        active_covariate_types: set[int] | None = None,
    ) -> dict[str, list[float]]:
        """Build covariate sequences (historical + future) for Ridge regression."""
        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)
        historical_dates = [ts.date() for ts in df["date"]]
        all_dates = historical_dates + list(future_dates)
        all_weekdays = [d.weekday() + 1 for d in all_dates]  # 1=Mon .. 7=Sun

        result: dict[str, list[float]] = {}

        # Weekday one-hot
        if active_covariate_types is None or 1 in active_covariate_types:
            flags = weekday_correction if weekday_correction is not None else [True] * 7
            for dow in range(1, 8):
                if flags[dow - 1]:
                    result[f"dow_{dow}"] = [1.0 if wd == dow else 0.0 for wd in all_weekdays]

        # Financial covariates (exclude profit_per_unit — margin, not demand driver)
        _EXCLUDED = {"cost_per_unit", "profit_per_unit"}
        if covariates and (active_covariate_types is None or 2 in active_covariate_types):
            for feature, date_map in covariates.items():
                if feature not in _EXCLUDED:
                    result[feature] = [float(date_map.get(d, 0.0)) for d in all_dates]

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
        """Redistribute weekly total to match historical weekday proportions."""
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
        """Newsvendor-optimal draw using critical fractile."""
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
