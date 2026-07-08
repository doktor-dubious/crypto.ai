"""TabPFN-TS prediction engine (Prior Labs) — LOCAL-ONLY.

Reference implementation for porting into another project (e.g. crypto.ai).
TabPFN-TS reframes forecasting as tabular in-context regression over the
TabPFN-v2 foundation model. Its strength is short / sparse / cold-start series,
complementing the pretrained sequence forecasters.

DATA RESIDENCY — this engine is deliberately LOCAL-ONLY and FAIL-CLOSED.
TabPFN-TS can run against Prior Labs' *cloud* API (``TabPFNMode.CLIENT``), which
would transmit your series off-box. To make that impossible:
  * require the local ``tabpfn`` package to be importable — without it the engine
    reports unavailable and the caller falls back to statistical (it never
    silently switches to the cloud client);
  * construct the pipeline with ``tabpfn_mode=TabPFNMode.LOCAL`` explicitly;
  * disable usage telemetry.
KEEP THIS BEHAVIOUR unless your project explicitly allows cloud inference.

Local mode needs ``tabpfn>=6.0.6`` + ``tabpfn-time-series`` and acceptance of the
Prior Labs license; the TabPFN-TS-3 checkpoint downloads automatically on first
use. A GPU is recommended but not required.

Covariates use the inherited model-agnostic external-Ridge path.

INTEGRATION CHECKLIST:
  1. Fix the ``from crypto_ai.prediction...`` imports to your package name.
  2. Dependencies: ``tabpfn-time-series`` + ``tabpfn>=6.0.6``. Conflicts with
     flowstate/toto/autogluon/moirai/yinglong/kairos → run in an isolated worker.
  3. Register: add ``TABPFN = "tabpfn"`` to the engine enum and
     ``self.register(PredictionEngineEnum.TABPFN, TabPFNTSEngine)`` in the registry.
  4. If your engine list is DB-driven, insert a ``prediction_engine`` row with
     slug ``tabpfn`` (model/precision are effectively no-ops here — only batch_size
     is meaningful, so a batch_size param row is enough).
"""

import logging

import numpy as np
import pandas as pd

# NOTE: fix these import paths to your project's package name.
from crypto_ai.prediction.engine import EngineCapabilities, MemoryEstimate
from crypto_ai.prediction.engines.chronos_pipeline_engine import (
    _QUANTILE_LEVELS,
    ChronosPipelineEngine,
    _sanitize_nan,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "tabpfn-ts"

# Quantile levels requested from predict_df, matching the system's P10..P90.
_QUANTILE_LIST: list[float] = [round(float(q), 2) for q in _QUANTILE_LEVELS]

# Synthetic daily index anchor (TabPFN derives temporal features from the
# timestamp column; the engine is otherwise calendar-agnostic).
_ANCHOR = "2000-01-01"

_TABPFN_AVAILABLE: bool | None = None


class TabPFNTSEngine(ChronosPipelineEngine):
    """TabPFN-TS engine — local-only, load once, predict many.

    Each item is forecast independently via ``predict_df``. Covariate effects are
    applied with the inherited external-Ridge-on-residuals path.
    """

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        super().__init__(model_id=model_id, default_precision="float32")

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="TabPFN-TS",
            description="Prior Labs TabPFN-TS (local-only; strong on short/sparse series)",
            supports_multivariate=False,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=3,
            max_history_length=4096,
            max_horizon=64,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def estimate_memory(self, *, task_type: str = "prediction", num_outlets: int = 1,
                        batch_size: int = 8, horizon: int = 30, context_length: int = 512,
                        num_covariates: int = 0, precision: str = "float32",
                        epochs: int = 0) -> MemoryEstimate:
        # TabPFN-v2 in-context inference: model + per-series activation footprint.
        model_mb = 500.0
        effective_batch = min(batch_size or self._batch_size, num_outlets)
        context_mb = effective_batch * context_length * 8 / (1024 * 1024)
        output_mb = effective_batch * horizon * 9 * 4 / (1024 * 1024)
        ridge_mb = effective_batch * context_length * max(num_covariates, 1) * 8 / (1024 * 1024)
        inference_mb = context_mb + output_mb + ridge_mb + 200
        multiplier = {"simulation": 1.3, "finetune": 4.0}.get(task_type, 1.0)
        total = model_mb + inference_mb * multiplier
        return MemoryEstimate(
            model_mb=round(model_mb, 1),
            inference_mb=round(inference_mb * multiplier, 1),
            total_mb=round(total, 1),
            gpu_required=False,
            task_type=task_type,
            breakdown={"model": round(model_mb, 1), "context": round(context_mb, 1),
                       "output": round(output_mb, 1), "ridge": round(ridge_mb, 1),
                       "overhead": 200},
        )

    # -- model loading (fail-closed local-only) ------------------------------

    def _check_tabpfn(self) -> bool:
        global _TABPFN_AVAILABLE
        if _TABPFN_AVAILABLE is None:
            try:
                # The local backend is REQUIRED: its presence is what guarantees
                # we never need (or use) the cloud client.
                import tabpfn  # noqa: F401
                import tabpfn_time_series  # noqa: F401

                _TABPFN_AVAILABLE = True
                logger.info("tabpfn-time-series + local tabpfn available")
            except ImportError:
                _TABPFN_AVAILABLE = False
                logger.warning(
                    "tabpfn-time-series and/or local 'tabpfn' not installed; "
                    "TabPFN-TS is local-only and will NOT use the cloud client, "
                    "so it is unavailable here — falling back to statistical"
                )
        return _TABPFN_AVAILABLE

    def _load_model(self) -> None:
        """Construct the TabPFN-TS pipeline in LOCAL mode only."""
        if self._model_loaded:
            return
        if not self._check_tabpfn():
            self._model_loaded = True
            return
        self._apply_hf_env()
        try:
            import os

            # No data should leave the box.
            os.environ.setdefault("TABPFN_DISABLE_TELEMETRY", "1")
            from tabpfn_time_series import TabPFNMode, TabPFNTSPipeline

            # Explicit LOCAL mode — never CLIENT (cloud).
            self._pipeline = TabPFNTSPipeline(tabpfn_mode=TabPFNMode.LOCAL)
            logger.info("TabPFN-TS pipeline loaded (LOCAL mode)")
        except Exception as e:
            # Fail closed: on any error we go to statistical, never to the cloud.
            logger.warning("Failed to load TabPFN-TS (local), falling back to statistical: %s", e)
            self._pipeline = None
        finally:
            self._model_loaded = True

    # -- quantile column resolution ------------------------------------------

    @staticmethod
    def _resolve_quantile_columns(df: pd.DataFrame) -> list[str]:
        """Map each requested quantile level to its column in predict_df output."""
        numeric_cols: dict[float, str] = {}
        for c in df.columns:
            try:
                numeric_cols[round(float(c), 4)] = c
            except (TypeError, ValueError):
                continue
        cols: list[str] = []
        for q in _QUANTILE_LIST:
            candidates = [f"{q:g}", str(q), f"{q:.1f}", f"{q:.2f}"]
            match = next((c for c in candidates if c in df.columns), None)
            if match is None:
                match = numeric_cols.get(round(q, 4))
            if match is None:
                raise KeyError(f"Quantile column for level {q} not found in {list(df.columns)}")
            cols.append(match)
        return cols

    # -- batch inference (sync, runs in thread pool) -------------------------

    def _run_batch_inference(
        self,
        batch: list[dict],
        horizon: int,
    ) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], list[dict]]:
        """Run TabPFN-TS predict_df per item + inherited external-Ridge covariates."""
        results = []
        ridge_infos = []
        for item in batch:
            values = np.asarray(item["values"], dtype=np.float64)
            n_hist = len(values)
            hist_dates = pd.date_range(_ANCHOR, periods=n_hist, freq="D")

            context_df = pd.DataFrame(
                {"item_id": 0, "timestamp": hist_dates, "target": values}
            )
            pred_df = self._pipeline.predict_df(
                context_df,
                prediction_length=horizon,
                quantiles=_QUANTILE_LIST,
            )

            # Output is indexed by (item_id, timestamp); normalise to columns.
            pred_df = pred_df.reset_index()
            if "timestamp" in pred_df.columns:
                pred_df = pred_df.sort_values("timestamp")
            qcols = self._resolve_quantile_columns(pred_df)
            base_quantiles = pred_df[qcols].to_numpy(dtype=np.float64)  # (horizon, 9)
            base_quantiles = np.sort(base_quantiles, axis=1)            # non-crossing
            base_pred = base_quantiles[:, 4]    # P50
            base_lower = base_quantiles[:, 0]   # P10
            base_upper = base_quantiles[:, -1]  # P90

            adj, ridge_info = self._residual_ridge_adjustment(item, base_pred, horizon)
            ridge_infos.append(ridge_info)
            results.append((
                _sanitize_nan(base_pred + adj),
                _sanitize_nan(base_lower + adj),
                _sanitize_nan(base_upper + adj),
                _sanitize_nan(base_quantiles + adj[:, np.newaxis]),
            ))

        return results, ridge_infos
