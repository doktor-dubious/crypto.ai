"""Salesforce MOIRAI-2 prediction engine."""

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
DEFAULT_MODEL_ID = "Salesforce/moirai-2.0-R-small"
_UNI2TS_AVAILABLE: bool | None = None

# Number of outlets batched in one GluonTS predictor.predict() call.
BATCH_SIZE = 32
# Cap how much history is passed as context (MOIRAI-2 supports up to 8192).
MAX_CONTEXT = 2000


class Moirai2Engine(PredictionEngine):
    """Salesforce MOIRAI-2 prediction engine.

    Uses the uni2ts library (Salesforce AI Research) with the GluonTS interface
    for zero-shot time series forecasting.  All outlets in a predict_batch() call
    are passed as separate items in a single PandasDataset → predictor.predict()
    call so the model only runs one forward pass per batch.

    MOIRAI-2 natively outputs quantile forecasts (P10–P90) which are used
    directly for the Newsvendor EO computation — no post-hoc sampling needed.

    The Moirai2Module (weights) is loaded once and cached on the engine instance.
    Only the lightweight Moirai2Forecast wrapper is recreated per call to
    accommodate different prediction horizons.

    Falls back to StatisticalEngine when uni2ts is not installed.
    """

    _MODEL_ALIASES: dict[str, str] = {
        "moirai-2.0-R-small": "Salesforce/moirai-2.0-R-small",
        "moirai-2-small": "Salesforce/moirai-2.0-R-small",
        "small": "Salesforce/moirai-2.0-R-small",
    }

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        self._model_id = model_id
        self._module = None        # cached Moirai2Module (weights)
        self._module_loaded = False
        self._batch_size: int = BATCH_SIZE

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Salesforce MOIRAI-2",
            description="Salesforce MOIRAI-2 foundation model — native quantile forecasting, zero-shot",
            supports_multivariate=False,
            supports_exogenous=False,
            supports_uncertainty=True,
            min_history_length=10,
            max_history_length=8192,
            max_horizon=64,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def _resolve_model_id(self, value: str) -> str:
        name = value.split("(")[0].strip()
        if "/" in name:
            return name
        return self._MODEL_ALIASES.get(name, f"Salesforce/{name}")

    def apply_parameters(self, params: dict[str, str]) -> None:
        """Apply DB-driven parameters before the first prediction.

        Supported parameter names:
          model / submodel – HuggingFace model ID or short name
          batch_size       – outlets per forward pass (int)
        """
        model_value = params.get("model") or params.get("submodel")
        if model_value:
            self._model_id = self._resolve_model_id(model_value)
        if "batch_size" in params:
            self._batch_size = int(params["batch_size"])

    def _check_uni2ts(self) -> bool:
        global _UNI2TS_AVAILABLE
        if _UNI2TS_AVAILABLE is None:
            try:
                from uni2ts.model.moirai2 import Moirai2Forecast, Moirai2Module  # noqa: F401
                _UNI2TS_AVAILABLE = True
                logger.info("uni2ts (MOIRAI-2) is available")
            except ImportError:
                _UNI2TS_AVAILABLE = False
                logger.warning("uni2ts not installed; MOIRAI-2 unavailable, falling back to statistical")
        return _UNI2TS_AVAILABLE

    def get_actual_slug(self) -> str | None:
        if not self._check_uni2ts():
            return "statistical"
        return None

    def _apply_hf_env(self) -> None:
        """Push HF_TOKEN and HF_HUB_CACHE from settings into os.environ."""
        import os

        from gorm_ai.config import get_settings

        s = get_settings()
        if s.hf_token:
            os.environ.setdefault("HF_TOKEN", s.hf_token)
        if s.hf_hub_cache:
            abs_cache = os.path.abspath(s.hf_hub_cache)
            os.environ.setdefault("HF_HUB_CACHE", abs_cache)
            logger.debug("HF_HUB_CACHE set to '%s'", abs_cache)

    def _load_module(self) -> bool:
        """Load and cache the Moirai2Module weights from HuggingFace.

        Returns True on success, False on failure (engine will fall back to statistical).
        Idempotent — subsequent calls return the cached result immediately.
        """
        if self._module_loaded:
            return self._module is not None
        self._apply_hf_env()
        try:
            from uni2ts.model.moirai2 import Moirai2Module

            self._module = Moirai2Module.from_pretrained(self._model_id)
            logger.info("MOIRAI-2 module loaded from '%s'", self._model_id)
        except Exception as e:
            logger.warning("Failed to load MOIRAI-2 module, falling back to statistical: %s", e)
            self._module = None
        finally:
            self._module_loaded = True
        return self._module is not None

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
        """Generate predictions for a single outlet (delegates to predict_batch)."""
        results = await self.predict_batch(
            [{"historical_data": historical_data, "covariates": covariates, "pad_dates": pad_dates}],
            horizon=horizon,
            prediction_from=prediction_from,
            holding_rate=holding_rate,
            protection_days=protection_days,
        )
        return results[0]

    async def predict_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from: date,
        batch_size: int = BATCH_SIZE,
        holding_rate: float = 0.25,
        protection_days: int = 7,
    ) -> list[list[PredictionResult]]:
        """Predict for multiple outlets in a single MOIRAI-2 forward pass.

        All outlets are passed as separate items in a GluonTS PandasDataset.
        Falls back to StatisticalEngine if uni2ts is not installed or the module
        fails to load.
        """
        if not items:
            return []

        if not self._check_uni2ts():
            from gorm_ai.prediction.engines.statistical import StatisticalEngine
            return await StatisticalEngine().predict_batch(items, horizon, prediction_from, batch_size)

        loop = asyncio.get_event_loop()

        # Load weights on first call (offloaded — from_pretrained blocks on network I/O).
        if not self._module_loaded:
            ok = await loop.run_in_executor(None, self._load_module)
            if not ok:
                from gorm_ai.prediction.engines.statistical import StatisticalEngine
                return await StatisticalEngine().predict_batch(
                    items, horizon, prediction_from, batch_size
                )

        return await loop.run_in_executor(
            None,
            self._run_moirai_batch,
            items, horizon, prediction_from, holding_rate, protection_days,
        )

    def _run_moirai_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from: date,
        holding_rate: float,
        protection_days: int,
    ) -> list[list[PredictionResult]]:
        """Sync: single MOIRAI-2 inference for all outlets combined."""
        from gluonts.dataset.pandas import PandasDataset
        from uni2ts.model.moirai2 import Moirai2Forecast

        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)

        # --- Step 1: preprocess each outlet ---
        prepared = []
        for i, item in enumerate(items):
            pp = DataPreprocessor(fill_missing=True, normalize=False)
            df = pp.preprocess(item["historical_data"])
            prepared.append({
                "key": str(i),
                "df": df,
                "n_hist": len(df),
                "covariates": item.get("covariates"),
                "historical_data": item["historical_data"],
                "variation_adjustment": item.get("variation_adjustment"),
            })

        # --- Step 2: build GluonTS PandasDataset (one series per outlet) ---
        series_dict: dict[str, pd.DataFrame] = {}
        for p in prepared:
            ts_df = pd.DataFrame(
                {"target": p["df"]["value"].values},
                index=pd.DatetimeIndex(p["df"]["date"]),
            )
            series_dict[p["key"]] = ts_df

        ds = PandasDataset(series_dict, target="target", freq="D")

        # --- Step 3: create Moirai2Forecast for this horizon + context length ---
        max_hist = max(p["n_hist"] for p in prepared)
        context_length = min(max_hist, MAX_CONTEXT)

        model = Moirai2Forecast(
            module=self._module,
            prediction_length=horizon,
            context_length=context_length,
            target_dim=1,
            feat_dynamic_real_dim=0,
            past_feat_dynamic_real_dim=0,
        )
        predictor = model.create_predictor(batch_size=self._batch_size)

        # --- Step 4: run inference ---
        forecasts = list(predictor.predict(ds))
        forecast_by_key = {fc.item_id: fc for fc in forecasts}

        # --- Step 5: extract results per outlet ---
        output: list[list[PredictionResult]] = []
        for p in prepared:
            fc = forecast_by_key.get(p["key"])
            if fc is None:
                logger.warning("MOIRAI-2: no forecast returned for item %s", p["key"])
                output.append([])
                continue

            mean_vals = fc.mean                                           # (horizon,)
            lower = fc.quantile(0.1)                                      # (horizon,)
            upper = fc.quantile(0.9)                                      # (horizon,)
            all_quantiles = np.column_stack(                              # (horizon, 9)
                [fc.quantile(float(q)) for q in _QUANTILE_LEVELS]
            )

            va = p.get("variation_adjustment", {})
            weekday_cvs = None
            if va.get("enabled") if isinstance(va, dict) else va:
                days = (
                    va.get("history_days", 365)
                    if isinstance(va, dict) else 365
                )
                weekday_cvs = self._compute_weekday_cvs(
                    p["historical_data"], days,
                )

            day_results = []
            for idx, fd in enumerate(future_dates):
                eo = self._compute_economic_optimal(
                    fd, idx, all_quantiles, p["covariates"],
                    weekday_cvs=weekday_cvs,
                )
                day_results.append(PredictionResult(
                    date=fd,
                    predicted_value=float(mean_vals[idx]),
                    lower_bound=float(lower[idx]),
                    upper_bound=float(upper[idx]),
                    confidence=0.80,
                    economic_optimal=eo,
                    quantiles=[float(all_quantiles[idx, j]) for j in range(all_quantiles.shape[1])],
                    cv=weekday_cvs.get(fd.weekday()) if weekday_cvs else None,
                ))
            output.append(day_results)

        return output

    def _compute_economic_optimal(
        self,
        pred_date: date,
        day_index: int,
        all_quantiles: np.ndarray,
        covariates: dict[str, dict[date, float]] | None,
        weekday_cvs: dict[int, float] | None = None,
    ) -> float | None:
        """Newsvendor-optimal draw using τ = (selling_price − production_cost) / selling_price.

        - cost_per_unit   = production cost per unit (Co: wasted on unsold units)
        - profit_per_unit = selling price per unit
        - Cu              = selling_price − production_cost (margin lost per missed sale)

        When weekday_cvs is provided, τ is adjusted upward for
        high-variation weekdays to protect against stockouts.
        """
        if covariates is None:
            return None
        selling_price = covariates.get("profit_per_unit", {}).get(pred_date, 0.0)
        production_cost = covariates.get("cost_per_unit", {}).get(pred_date, 0.0)
        if selling_price <= 0 or production_cost <= 0 or selling_price <= production_cost:
            logger.debug(
                "EO: invalid financials on %s — selling_price=%.4f production_cost=%.4f",
                pred_date, selling_price, production_cost,
            )
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
        """Compute coefficient of variation per weekday."""
        from collections import defaultdict

        if not historical_data:
            return {}

        cutoff = (
            historical_data[-1]["date"] - timedelta(days=history_days)
        )
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
