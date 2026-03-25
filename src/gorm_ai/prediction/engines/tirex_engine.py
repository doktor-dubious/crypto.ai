"""TiRex prediction engine (NX-AI).

Uses the TiRex foundation model via the ``tirex-ts`` package.  TiRex is a
35M parameter xLSTM-based model that outputs quantile forecasts directly.

Works on CPU by default; optional CUDA backend for faster inference.

Covariates are handled via Ridge regression on residuals, identical to the
approach used by the Chronos and TimesFM engines.
"""

import asyncio
import logging
from collections import defaultdict
from datetime import date, timedelta

import numpy as np
import pandas as pd

from gorm_ai.prediction.engine import EngineCapabilities, PredictionEngine, interpolate_quantile
from gorm_ai.prediction.preprocessor import DataPreprocessor
from gorm_ai.schemas.prediction import PredictionResult

logger = logging.getLogger(__name__)

_QUANTILE_LEVELS = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])

BATCH_SIZE = 16
MAX_CONTEXT = 2048
MAX_HORIZON = 720

DEFAULT_MODEL_ID = "NX-AI/TiRex"

_TIREX_AVAILABLE: bool | None = None


class TiRexEngine(PredictionEngine):
    """TiRex foundation model engine — load once, predict many.

    NX-AI TiRex (35M params) is an xLSTM-based model that outputs quantile
    forecasts and a mean point prediction directly.  No sampling needed.

    Works on CPU by default; set backend="cuda" for GPU acceleration
    (requires compute capability >= 8.0).

    Covariates (weekday dummies, financials, PAD events) are incorporated via
    Ridge regression on residuals, identical to the Chronos/TimesFM approach.
    """

    _VALID_BACKENDS = {"cpu", "cuda"}

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        self._model_id = model_id
        self._model = None
        self._model_loaded = False
        self._last_ridge_results: list[dict] | None = None
        self._batch_size: int = BATCH_SIZE
        self._backend: str = "cpu"

    _MODEL_ALIASES: dict[str, str] = {
        "tirex": "NX-AI/TiRex",
        "tirex-1.1-gifteval": "NX-AI/TiRex-1.1-gifteval",
    }

    def _resolve_model_id(self, value: str) -> str:
        name = value.split("(")[0].strip()
        if "/" in name:
            return name
        return self._MODEL_ALIASES.get(name.lower(), f"NX-AI/{name}")

    def apply_parameters(self, params: dict[str, str]) -> None:
        """Apply DB-driven parameters before the first prediction.

        Supported parameter names:
          model / submodel – HuggingFace model ID or short name
          backend          – "cpu" or "cuda"
          batch_size       – outlets per forward pass (int)
        """
        model_value = params.get("model") or params.get("submodel")
        if model_value:
            self._model_id = self._resolve_model_id(model_value)
        if "backend" in params:
            b = params["backend"]
            if b in self._VALID_BACKENDS:
                self._backend = b
            else:
                logger.warning(
                    "Ignoring unknown backend '%s'; valid: %s", b, self._VALID_BACKENDS
                )
        if "batch_size" in params:
            self._batch_size = int(params["batch_size"])

    # -- capabilities --------------------------------------------------------

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="TiRex",
            description="NX-AI TiRex xLSTM foundation model — 35M params, quantile output",
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

    def _check_tirex(self) -> bool:
        global _TIREX_AVAILABLE
        if _TIREX_AVAILABLE is None:
            try:
                from tirex import load_model  # noqa: F401

                _TIREX_AVAILABLE = True
                logger.info("tirex-ts is available")
            except ImportError:
                _TIREX_AVAILABLE = False
                logger.warning(
                    "tirex-ts not installed; TiRex unavailable, falling back to statistical. "
                    "Install via: pip install tirex-ts"
                )
        return _TIREX_AVAILABLE

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
        """Load the TiRex model once and cache it."""
        if self._model_loaded:
            return
        if not self._check_tirex():
            self._model_loaded = True
            return
        self._apply_hf_env()
        try:
            from tirex import load_model

            self._model = load_model(self._model_id, backend=self._backend)
            logger.info(
                "TiRex model loaded: %s (backend: %s)",
                self._model_id, self._backend,
            )
        except Exception as e:
            logger.warning("Failed to load TiRex model, falling back to statistical: %s", e)
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
        """Single TiRex forward pass for a batch + per-outlet Ridge regression.

        TiRex's model.forecast() returns (quantiles, mean):
          - quantiles shape: (batch, num_quantiles, horizon)
          - mean shape: (batch, horizon)

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
            np.stack(contexts), dtype=torch.float32
        )  # (batch_size, max_len)

        with torch.no_grad():
            quantiles_out, mean_out = self._model.forecast(
                context=context_tensor, prediction_length=horizon,
            )
        # quantiles_out: (batch, num_quantiles, horizon)
        # mean_out: (batch, horizon)
        quantiles_np = quantiles_out.cpu().float().numpy()
        mean_np = mean_out.cpu().float().numpy()

        n_q = quantiles_np.shape[1]
        if n_q == 9:
            # Already P10–P90 — transpose to (batch, horizon, 9)
            forecast_quantiles = quantiles_np.transpose(0, 2, 1)
        else:
            # Pick closest indices to our standard quantile levels.
            model_levels = np.linspace(0, 1, n_q + 2)[1:-1]
            target_indices = [
                int(np.argmin(np.abs(model_levels - q))) for q in _QUANTILE_LEVELS
            ]
            forecast_quantiles = quantiles_np[:, target_indices, :].transpose(0, 2, 1)

        results = []
        ridge_infos = []
        for i, item in enumerate(batch):
            values = item["values"]
            hist_X = item["hist_X"]
            fut_X = item["fut_X"]

            base_quantiles = forecast_quantiles[i]  # (horizon, 9)
            base_pred = mean_np[i]  # Use TiRex's mean as point forecast
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
        all_weekdays = [d.weekday() + 1 for d in all_dates]

        result: dict[str, list[float]] = {}

        flags = weekday_correction if weekday_correction is not None else [True] * 7
        for dow in range(1, 8):
            if flags[dow - 1]:
                result[f"dow_{dow}"] = [1.0 if wd == dow else 0.0 for wd in all_weekdays]

        _EXCLUDED = {"profit_per_unit"}
        if covariates:
            for feature, date_map in covariates.items():
                if feature not in _EXCLUDED:
                    result[feature] = [float(date_map.get(d, 0.0)) for d in all_dates]

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

        return interpolate_quantile(tau, all_quantiles[day_index])

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
