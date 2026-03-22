"""Sundial prediction engine (THU-ML).

Uses the Sundial foundation model from Tsinghua University via HuggingFace
Transformers.  The model generates multiple probabilistic sample paths which
are aggregated into quantile forecasts (P10–P90).

Covariates are handled via Ridge regression on residuals, identical to the
approach used by the Chronos and TimesFM engines.
"""

import asyncio
import logging
from collections import defaultdict
from datetime import date, timedelta

import numpy as np
import pandas as pd

from gorm_ai.prediction.engine import EngineCapabilities, PredictionEngine
from gorm_ai.prediction.preprocessor import DataPreprocessor
from gorm_ai.schemas.prediction import PredictionResult

logger = logging.getLogger(__name__)

_QUANTILE_LEVELS = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])

# Outlets per forward pass — Sundial is a decoder-only transformer so
# KV-cache grows with num_samples × context length.
BATCH_SIZE = 8

# Monte-Carlo sample paths per context.  20 gives stable P10–P90 quantiles.
NUM_SAMPLES = 20

DEFAULT_MODEL_ID = "thuml/sundial-base-128m"
PATCH_LEN = 16        # Sundial's input_token_len — input must be a multiple
MAX_CONTEXT = 2880    # Sundial supports up to 2880
MAX_HORIZON = 720     # Sundial supports multi-patch up to 720

_SUNDIAL_AVAILABLE: bool | None = None


class SundialEngine(PredictionEngine):
    """Sundial foundation model engine — load once, predict many.

    Loads the Sundial causal transformer via HuggingFace Transformers and caches
    it for the lifetime of the Celery worker process.  Inference produces
    multiple sample paths which are aggregated into quantile forecasts.

    Covariates (weekday dummies, financials, PAD events) are incorporated via
    Ridge regression on residuals, identical to the Chronos/TimesFM approach.
    """

    _VALID_PRECISIONS = {"float32", "bfloat16", "float16"}

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        self._model_id = model_id
        self._model = None
        self._model_loaded = False
        self._last_ridge_results: list[dict] | None = None
        self._num_samples: int = NUM_SAMPLES
        self._batch_size: int = BATCH_SIZE
        self._precision: str = "float32"

    _MODEL_ALIASES: dict[str, str] = {
        "sundial-base-128m": "thuml/sundial-base-128m",
    }

    def _resolve_model_id(self, value: str) -> str:
        name = value.split("(")[0].strip()
        if "/" in name:
            return name
        return self._MODEL_ALIASES.get(name, f"thuml/{name}")

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
                logger.warning(
                    "Ignoring unknown precision '%s'; valid: %s", p, self._VALID_PRECISIONS
                )
        if "batch_size" in params:
            self._batch_size = int(params["batch_size"])

    # -- capabilities --------------------------------------------------------

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Sundial",
            description="THU-ML Sundial foundation model — generative probabilistic forecasting",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=16,
            max_history_length=MAX_CONTEXT,
            max_horizon=MAX_HORIZON,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def get_actual_slug(self) -> str | None:
        if self._model_loaded and self._model is None:
            return "statistical"
        return None

    # -- model loading -------------------------------------------------------

    def _check_sundial(self) -> bool:
        global _SUNDIAL_AVAILABLE
        if _SUNDIAL_AVAILABLE is None:
            try:
                from transformers import AutoModelForCausalLM  # noqa: F401
                _SUNDIAL_AVAILABLE = True
                logger.info("transformers is available for Sundial")
            except ImportError:
                _SUNDIAL_AVAILABLE = False
                logger.warning(
                    "transformers not installed; Sundial unavailable, falling back to statistical"
                )
        return _SUNDIAL_AVAILABLE

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

    @staticmethod
    def _patch_dynamic_cache() -> None:
        """Add compatibility shims for transformers ≥4.45.

        Sundial's custom model code was written against an older transformers
        API.  Three ``DynamicCache`` methods were removed/renamed:

          seen_tokens    → get_seq_length()
          get_max_length → max_cache_len (property, crashes on empty cache)
          get_usable_length → removed (was seq_length capped by max)
        """
        from transformers import DynamicCache

        if not hasattr(DynamicCache, "seen_tokens"):
            DynamicCache.seen_tokens = property(lambda self: self.get_seq_length())

        if not hasattr(DynamicCache, "get_max_length"):
            def _get_max_length(self):
                try:
                    return self.max_cache_len if self.layers else None
                except (ValueError, AttributeError):
                    return None
            DynamicCache.get_max_length = _get_max_length

        if not hasattr(DynamicCache, "get_usable_length"):
            def _get_usable_length(self, new_seq_length, max_length=None):
                if max_length is None:
                    max_length = self.get_max_length()
                prev = self.get_seq_length()
                if max_length is not None and prev + new_seq_length > max_length:
                    return max_length - new_seq_length
                return prev
            DynamicCache.get_usable_length = _get_usable_length

        logger.debug("Patched DynamicCache compatibility shims for Sundial")

    def _load_model(self) -> None:
        """Load the Sundial model once and cache it."""
        if self._model_loaded:
            return
        if not self._check_sundial():
            self._model_loaded = True
            return
        self._apply_hf_env()
        self._patch_dynamic_cache()
        try:
            import torch
            from transformers import AutoModelForCausalLM

            dtype_map = {
                "float32": torch.float32,
                "bfloat16": torch.bfloat16,
                "float16": torch.float16,
            }
            device = "cuda" if torch.cuda.is_available() else "cpu"
            self._model = AutoModelForCausalLM.from_pretrained(
                self._model_id,
                trust_remote_code=True,
                torch_dtype=dtype_map[self._precision],
            )
            self._model.to(device)
            self._model.eval()
            self._device = device
            logger.info("Sundial model loaded: %s (%s, device: %s)", self._model_id, self._precision, device)
        except Exception as e:
            logger.warning("Failed to load Sundial model, falling back to statistical: %s", e)
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

        # Use DB-configured batch size when caller uses the default.
        if batch_size == BATCH_SIZE:
            batch_size = self._batch_size

        if not self._model_loaded:
            self._load_model()

        if self._model is None:
            from gorm_ai.prediction.engines.statistical import StatisticalEngine
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
            preds = pp.denormalize(preds_norm)
            lower = pp.denormalize(lower_norm)
            upper = pp.denormalize(upper_norm)
            quantiles = pp.denormalize(quantiles_norm)

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

            day_results = []
            for idx, pred_date in enumerate(future_dates):
                economic_optimal = self._compute_economic_optimal(
                    pred_date, idx, quantiles,
                    item.get("covariates"), holding_rate, protection_days,
                    weekday_cvs=weekday_cvs,
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
        """Single Sundial forward pass for a batch + per-outlet Ridge regression.

        Calls ``model.forward()`` directly instead of ``generate()`` to avoid
        compatibility issues between Sundial's custom code and newer
        transformers versions.  Sundial uses flow-matching (diffusion) to
        produce all output time steps in a single forward pass — no
        autoregressive loop needed.

        Returns:
          - list of (predictions, lower, upper, all_quantiles) tuples (normalised)
          - list of ridge_info dicts
        """
        import torch
        from sklearn.linear_model import Ridge

        # Build batch context tensor.  SundialPatchEmbedding handles padding
        # to a multiple of PATCH_LEN internally, so we don't need to align.
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
            np.stack(contexts), dtype=torch.float32
        )  # (batch_size, max_len)

        # Call forward() directly — max_output_length is in time steps.
        # Disable KV cache (not needed for single-pass flow-matching inference).
        with torch.no_grad():
            output = self._model(
                input_ids=context_tensor,
                max_output_length=horizon,
                num_samples=self._num_samples,
                use_cache=False,
            )
        # output.logits shape: (batch, num_samples, output_token_len)
        # Trim to exact horizon.
        forecast_np = output.logits.cpu().numpy()[:, :, :horizon]

        results = []
        ridge_infos = []
        for i, item in enumerate(batch):
            values = item["values"]
            hist_X = item["hist_X"]
            fut_X = item["fut_X"]

            outlet_samples = forecast_np[i]  # (num_samples, horizon)
            base_pred = np.median(outlet_samples, axis=0)
            base_quantiles = np.quantile(
                outlet_samples, _QUANTILE_LEVELS, axis=0
            ).T  # (horizon, 9)

            base_lower = base_quantiles[:, 0]   # P10
            base_upper = base_quantiles[:, -1]  # P90

            # Ridge regression on residuals for covariate adjustment.
            n_hist = len(values)
            align_len = min(n_hist, horizon)
            forecast_level = float(base_pred[0])
            residuals = values[-align_len:] - forecast_level
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

        nearest_idx = int(np.argmin(np.abs(_QUANTILE_LEVELS - tau)))
        return float(all_quantiles[day_index, nearest_idx])

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
