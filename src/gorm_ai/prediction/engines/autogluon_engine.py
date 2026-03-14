"""AutoGluon Chronos-Bolt prediction engine."""

import asyncio
import logging
import shutil
import tempfile
from datetime import date

import numpy as np
import pandas as pd

from gorm_ai.prediction.engine import EngineCapabilities, PredictionEngine
from gorm_ai.prediction.preprocessor import DataPreprocessor
from gorm_ai.schemas.prediction import PredictionResult

logger = logging.getLogger(__name__)

_QUANTILE_LEVELS = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
_AUTOGLUON_AVAILABLE: bool | None = None


class AutoGluonEngine(PredictionEngine):
    """AutoGluon Chronos-Bolt prediction engine.

    Uses AutoGluon's TimeSeriesPredictor with Chronos-Bolt as the underlying model.
    All outlets are batched into a single predictor call (different item_ids),
    which is AutoGluon's native batching mechanism.

    A fresh TimeSeriesPredictor is created and discarded per predict_batch() call
    (zero-shot: no training required). Temporary files written by AutoGluon are
    cleaned up after each call.
    """

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="AutoGluon Chronos-Bolt",
            description="Amazon Chronos-Bolt foundation model via AutoGluon (fast, zero-shot)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=2048,
            max_horizon=64,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def _check_autogluon(self) -> bool:
        global _AUTOGLUON_AVAILABLE
        if _AUTOGLUON_AVAILABLE is None:
            try:
                import autogluon.timeseries  # noqa: F401

                _AUTOGLUON_AVAILABLE = True
                logger.info("AutoGluon timeseries is available")
            except ImportError:
                _AUTOGLUON_AVAILABLE = False
                logger.warning("AutoGluon not installed; falling back to statistical")
        return _AUTOGLUON_AVAILABLE

    def get_actual_slug(self) -> str | None:
        if not self._check_autogluon():
            return "statistical"
        return None

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
        """Generate predictions using AutoGluon TimesFM (delegates to predict_batch)."""
        self.validate_input(historical_data, horizon)
        item = {
            "historical_data": historical_data,
            "covariates": covariates,
            "pad_dates": pad_dates,
        }
        results = await self.predict_batch(
            [item],
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
        batch_size: int = 64,
        holding_rate: float = 0.25,
        protection_days: int = 7,
    ) -> list[list[PredictionResult]]:
        """Predict for multiple outlets in a single AutoGluon TimeSeriesPredictor call.

        All outlets are passed as distinct item_ids in one TimeSeriesDataFrame, which
        AutoGluon batches internally. Falls back to StatisticalEngine if AutoGluon is
        not installed.
        """
        if not items:
            return []

        if not self._check_autogluon():
            from gorm_ai.prediction.engines.statistical import StatisticalEngine
            fallback = StatisticalEngine()
            return await fallback.predict_batch(items, horizon, prediction_from, batch_size)

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._run_autogluon_batch,
            items, horizon, prediction_from, batch_size, holding_rate, protection_days,
        )

    def _run_autogluon_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from: date,
        batch_size: int,
        holding_rate: float,
        protection_days: int,
    ) -> list[list[PredictionResult]]:
        """Sync: AutoGluon fit+predict, sub-batched by batch_size to bound memory use."""
        output: list[list[PredictionResult]] = []
        for start in range(0, len(items), batch_size):
            sub_items = items[start : start + batch_size]
            output.extend(
                self._run_single_autogluon_batch(
                    sub_items, horizon, prediction_from, holding_rate, protection_days
                )
            )
        return output

    def _run_single_autogluon_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from: date,
        holding_rate: float,
        protection_days: int,
    ) -> list[list[PredictionResult]]:
        """Sync: single AutoGluon fit+predict for one sub-batch of outlets."""
        from autogluon.timeseries import TimeSeriesDataFrame, TimeSeriesPredictor

        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)

        # Determine if any item has covariates (drives known_covariates_names)
        has_covariates = any(item.get("covariates") or item.get("pad_dates") for item in items)

        # --- Step 1: preprocess each outlet and build covariate arrays ---
        prepared = []
        covariate_names: list[str] = []
        for i, item in enumerate(items):
            pp = DataPreprocessor(fill_missing=True, normalize=False)
            df = pp.preprocess(item["historical_data"])
            n_hist = len(df)

            cov_arrays: dict[str, list[float]] = {}
            date_to_cov: dict = {}
            if has_covariates:
                cov_arrays = self._build_covariate_arrays(
                    df, prediction_from, horizon,
                    item.get("covariates"), item.get("pad_dates"),
                    item.get("weekday_correction"),
                )
                if i == 0:
                    covariate_names = sorted(cov_arrays.keys())
                # Attach historical slice as new columns on df
                for feat in covariate_names:
                    df = df.copy()
                    df[feat] = cov_arrays[feat][:n_hist]
                # Build date -> {feat: value} lookup covering hist + future
                hist_dates = [pd.Timestamp(row["date"]).date() for _, row in df.iterrows()]
                all_item_dates = hist_dates + list(future_dates)
                for idx, d in enumerate(all_item_dates):
                    date_to_cov[d] = {
                        feat: (cov_arrays[feat][idx] if idx < len(cov_arrays.get(feat, [])) else 0.0)
                        for feat in covariate_names
                    }

            prepared.append({
                "item_id": str(i),
                "df": df,
                "n_hist": n_hist,
                "cov_arrays": cov_arrays,
                "date_to_cov": date_to_cov,
                "covariates": item.get("covariates"),
            })

        # --- Step 2: assemble training TimeSeriesDataFrame ---
        train_rows = []
        for p in prepared:
            item_id = p["item_id"]
            for _, row in p["df"].iterrows():
                entry: dict = {
                    "item_id": item_id,
                    "timestamp": pd.Timestamp(row["date"]),
                    "target": float(row["value"]),
                }
                for feat in covariate_names:
                    entry[feat] = float(row[feat])
                train_rows.append(entry)

        train_df = pd.DataFrame(train_rows)
        ts_train = TimeSeriesDataFrame.from_data_frame(
            train_df,
            id_column="item_id",
            timestamp_column="timestamp",
        )

        # --- Step 3: build date→covariate maps for known_covariates lookup ---
        # Key: item_id (str) → feature → date → value
        item_date_cov: dict[str, dict[str, dict]] = {}
        if has_covariates and covariate_names:
            for p in prepared:
                hist_dates = [ts.date() for ts in p["df"]["date"]]
                all_dates_list = hist_dates + list(future_dates)
                feat_date_map: dict[str, dict] = {}
                for feat in covariate_names:
                    vals = p["cov_arrays"].get(feat, [])
                    feat_date_map[feat] = {
                        d: float(vals[i]) for i, d in enumerate(all_dates_list) if i < len(vals)
                    }
                item_date_cov[p["item_id"]] = feat_date_map

        # --- Step 4: fit + predict with AutoGluon TimeSeriesPredictor ---
        tmpdir = tempfile.mkdtemp(prefix="autogluon_gorm_")
        try:
            predictor_kwargs: dict = {
                "path": tmpdir,
                "prediction_length": horizon,
                "quantile_levels": list(_QUANTILE_LEVELS),
                "target": "target",
                "verbosity": 0,
            }
            if has_covariates and covariate_names:
                predictor_kwargs["known_covariates_names"] = covariate_names

            predictor = TimeSeriesPredictor(**predictor_kwargs)
            predictor.fit(ts_train, hyperparameters=self._get_hyperparameters())

            predict_kwargs: dict = {"data": ts_train}
            if has_covariates and covariate_names:
                # make_future_data_frame returns a plain DataFrame with item_id + timestamp columns.
                # Fill covariate values row-by-row then convert to TimeSeriesDataFrame.
                future_frame = predictor.make_future_data_frame(data=ts_train)
                for feat in covariate_names:
                    values: list[float] = []
                    for _, row in future_frame.iterrows():
                        item_id_str = str(row["item_id"])
                        ts = row["timestamp"]
                        d = ts.date() if hasattr(ts, "date") else pd.Timestamp(ts).date()
                        values.append(item_date_cov.get(item_id_str, {}).get(feat, {}).get(d, 0.0))
                    future_frame[feat] = values
                predict_kwargs["known_covariates"] = TimeSeriesDataFrame.from_data_frame(
                    future_frame, id_column="item_id", timestamp_column="timestamp"
                )

            preds = predictor.predict(**predict_kwargs)
            # preds: MultiIndex (item_id, timestamp), columns: "mean", "0.1".."0.9"
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

        # --- Step 5: extract per-outlet PredictionResult lists ---
        quantile_col_names = [str(q) for q in _QUANTILE_LEVELS]
        output: list[list[PredictionResult]] = []

        for p in prepared:
            item_id = p["item_id"]
            try:
                outlet_preds = preds.loc[item_id]
            except KeyError:
                logger.warning("AutoGluon dropped item_id=%s (insufficient history?)", item_id)
                output.append([])
                continue

            # Use positional indexing: AutoGluon forecasts relative to the last training date,
            # which may differ from prediction_from (data gaps). Map the i-th forecast value
            # to the i-th future_date regardless of the model's internal timestamps.
            day_results = []
            for i, fd in enumerate(future_dates):
                if i >= len(outlet_preds):
                    break
                row = outlet_preds.iloc[i]
                mean_val = float(row["mean"])
                lower = float(row["0.1"])
                upper = float(row["0.9"])
                q_vals = np.array([float(row[c]) for c in quantile_col_names])

                economic_optimal = self._compute_economic_optimal(
                    fd, q_vals, p["covariates"], holding_rate, protection_days
                )
                day_results.append(PredictionResult(
                    date=fd,
                    predicted_value=mean_val,
                    lower_bound=lower,
                    upper_bound=upper,
                    confidence=0.80,
                    economic_optimal=economic_optimal,
                ))
            output.append(day_results)

        return output

    def _compute_economic_optimal(
        self,
        pred_date: date,
        q_vals: np.ndarray,
        covariates: dict[str, dict[date, float]] | None,
        holding_rate: float,
        protection_days: int,
    ) -> float | None:
        """Newsvendor-optimal draw for a single day using per-day quantile array (shape: 9,).

        τ = (selling_price − production_cost) / selling_price, where:
          - cost_per_unit   = production cost per unit (Co: wasted on unsold units)
          - profit_per_unit = selling price per unit
          - Cu              = selling_price − production_cost (margin lost per missed sale)
        """
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
        return float(q_vals[nearest_idx])

    def _get_hyperparameters(self) -> dict:
        """Return AutoGluon hyperparameters dict for fit(). Override in subclasses."""
        return {"Chronos": {}}

    def _build_covariate_arrays(
        self,
        df: pd.DataFrame,
        prediction_from: date,
        horizon: int,
        covariates: dict[str, dict[date, float]] | None = None,
        pad_dates: dict[str, set[date]] | None = None,
        weekday_correction: list[bool] | None = None,
    ) -> dict[str, list[float]]:
        """Build full covariate sequences covering historical context + future horizon.

        Includes weekday one-hot features for each enabled day (dow_1=Mon .. dow_7=Sun).
        Financial covariates (date-keyed) and pad event indicators (date-keyed binary)
        are added when provided.
        """
        future_dates = DataPreprocessor.generate_future_dates(prediction_from, horizon)

        historical_dates = [ts.date() for ts in df["date"]]
        all_dates = historical_dates + list(future_dates)
        all_weekdays = [d.weekday() + 1 for d in all_dates]  # 1=Mon .. 7=Sun

        result: dict[str, list[float]] = {}

        # Weekday one-hot encoding (dow_1=Mon .. dow_7=Sun); each day is optional.
        # Enabled days get an explicit feature; disabled days are not corrected.
        flags = weekday_correction if weekday_correction is not None else [True] * 7
        for dow in range(1, 8):
            if flags[dow - 1]:
                result[f"dow_{dow}"] = [1.0 if wd == dow else 0.0 for wd in all_weekdays]

        # Financial covariates keyed by date — profit_per_unit is excluded because
        # it reflects margin, not end-user price, and does not influence demand.
        _EXCLUDED_COVARIATES = {"profit_per_unit"}
        if covariates:
            for feature, date_map in covariates.items():
                if feature not in _EXCLUDED_COVARIATES:
                    result[feature] = [float(date_map.get(d, 0.0)) for d in all_dates]

        # PAD event indicators — binary 1.0 on event dates
        if pad_dates:
            for pad_name, event_dates in pad_dates.items():
                result[pad_name] = [1.0 if d in event_dates else 0.0 for d in all_dates]

        return result
