"""Direct Chronos-2 prediction engine (amazon/chronos-2).

Reference implementation for porting into another project (e.g. crypto.ai).
Uses chronos-forecasting >= 2.2's ``Chronos2Pipeline.predict_df`` — the REAL
Chronos-2 model, NOT the Chronos-v1 t5 pipeline. Loaded once per worker and
reused across predictions.

Verified against chronos-forecasting==2.2.2. Real predict_df output columns:
    ['item_id', 'timestamp', 'target_name', 'predictions', '0.1', ..., '0.9']
i.e. a mean ``predictions`` column plus one column per quantile level, named by
the level string ('0.1'..'0.9').

Chronos-2 returns 9 quantiles directly (no sampling) and has NATIVE covariate
support via ``predict_df(future_df=...)``. This engine uses the inherited
external-Ridge covariate path for parity with the other engines; see the note in
``_run_batch_inference`` to switch to native covariates.

INTEGRATION CHECKLIST:
  1. Fix the three ``from crypto_ai.prediction...`` imports to your package name.
  2. Register: add ``CHRONOS2 = "chronos2"`` to the engine enum and
     ``self.register(PredictionEngineEnum.CHRONOS2, Chronos2Engine)`` in the registry.
     (Engine SLUG is ``chronos2`` — matches the existing enum. If a reverted v1
     ``chronos2`` engine already exists, replace its class with this one.)
  3. If your engine list is DB-driven, use/insert the ``prediction_engine`` row with
     slug ``chronos2`` (+ optional param rows: ``model=chronos-2`` selected — that
     is the MODEL alias resolving to ``amazon/chronos-2``, distinct from the slug;
     ``precision`` options for GPU).
  4. Ensure ``chronos-forecasting>=2.2.0`` is in the lockfile (2.2.2 confirmed).
  5. Set ``_MODEL_PARAMS["amazon/chronos-2"]`` to the real param count for accurate
     memory scheduling (placeholder below; does not affect correctness).
  6. ``predict_df`` needs regular, gap-free timestamps. This engine assigns each
     series a synthetic daily index, so it is safe as long as the base class has
     already filled/normalised the series before ``_run_batch_inference``.
"""

import logging

import numpy as np
import pandas as pd

# NOTE: fix these import paths to your project's package name.
from crypto_ai.prediction.engine import EngineCapabilities, MemoryEstimate
from crypto_ai.prediction.engines.chronos_pipeline_engine import (
    _QUANTILE_LEVELS,          # np.array([0.1, 0.2, ..., 0.9])
    ChronosPipelineEngine,
    _sanitize_nan,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "amazon/chronos-2"
_ANCHOR = "2000-01-01"                                   # synthetic daily index (calendar-agnostic)
_QUANTILE_LIST = [round(float(q), 2) for q in _QUANTILE_LEVELS]

_CHRONOS2_AVAILABLE: bool | None = None


class Chronos2Engine(ChronosPipelineEngine):
    """Amazon Chronos-2 — load once, predict many; quantiles direct from predict_df."""

    _MODEL_ALIASES: dict[str, str] = {
        "chronos-2": "amazon/chronos-2",
        "chronos2": "amazon/chronos-2",
    }
    _DEFAULT_PREFIX = "amazon/"

    _MODEL_PARAMS: dict[str, float] = {
        **ChronosPipelineEngine._MODEL_PARAMS,
        "amazon/chronos-2": 120e6,        # ~120M — adjust to the published count if needed
    }

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        # float32 is the safe CPU default; override via the "precision" param for GPU.
        super().__init__(model_id=model_id, default_precision="float32")
        self._device: str = "cpu"
        self._torch_dtype = None

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Chronos-2",
            description="Amazon Chronos-2 foundation model (direct predict_df, native covariates)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=8192,
            max_horizon=1024,
            supported_frequencies=["daily", "weekly", "monthly", "hourly"],
        )

    def estimate_memory(self, *, task_type: str = "prediction", num_outlets: int = 1,
                        batch_size: int = 8, horizon: int = 30, context_length: int = 512,
                        num_covariates: int = 0, precision: str = "float32",
                        epochs: int = 0) -> MemoryEstimate:
        params = self._MODEL_PARAMS.get(self._model_id, 120e6)
        bytes_per_param = 2 if precision in ("bfloat16", "float16") else 4
        model_mb = params * bytes_per_param / (1024 * 1024)
        effective_batch = min(batch_size or self._batch_size, num_outlets)
        context_mb = effective_batch * context_length * 4 / (1024 * 1024)
        output_mb = effective_batch * horizon * 9 * 4 / (1024 * 1024)
        ridge_mb = effective_batch * context_length * max(num_covariates, 1) * 8 / (1024 * 1024)
        inference_mb = context_mb + output_mb + ridge_mb + 150
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
                       "pytorch_overhead": 150},
        )

    # -- model loading -------------------------------------------------------

    def _check_chronos2(self) -> bool:
        global _CHRONOS2_AVAILABLE
        if _CHRONOS2_AVAILABLE is None:
            try:
                from chronos import Chronos2Pipeline  # noqa: F401
                _CHRONOS2_AVAILABLE = True
                logger.info("chronos-forecasting Chronos2Pipeline is available")
            except ImportError:
                _CHRONOS2_AVAILABLE = False
                logger.warning(
                    "chronos-forecasting>=2.2 (Chronos2Pipeline) not installed; "
                    "Chronos-2 unavailable, falling back to statistical"
                )
        return _CHRONOS2_AVAILABLE

    def _load_model(self) -> None:
        if self._model_loaded:
            return
        if not self._check_chronos2():
            self._model_loaded = True
            return
        self._apply_hf_env()
        try:
            import torch
            from chronos import Chronos2Pipeline

            dtype_map = {"float32": torch.float32, "bfloat16": torch.bfloat16,
                         "float16": torch.float16}
            device = "cuda" if torch.cuda.is_available() else "cpu"
            self._pipeline = Chronos2Pipeline.from_pretrained(
                self._model_id, device_map=device, torch_dtype=dtype_map[self._precision],
            )
            self._device = device
            self._torch_dtype = dtype_map[self._precision]
            logger.info("Chronos-2 loaded: %s (%s, device: %s)",
                        self._model_id, self._precision, device)
        except Exception as e:
            logger.warning("Failed to load Chronos-2, falling back to statistical: %s", e)
            self._pipeline = None
        finally:
            self._model_loaded = True

    # -- quantile column resolution -----------------------------------------

    @staticmethod
    def _resolve_quantile_columns(df: pd.DataFrame) -> list[str]:
        """Map each requested level to its predict_df column (named e.g. '0.1'..'0.9')."""
        cols: list[str] = []
        for q in _QUANTILE_LIST:
            match = next(
                (c for c in (f"{q:g}", str(q), f"{q:.1f}", f"{q:.2f}") if c in df.columns), None
            )
            if match is None:
                raise KeyError(f"Quantile column for level {q} not found in {list(df.columns)}")
            cols.append(match)
        return cols

    # -- batch inference (sync, runs in the base class's thread pool) --------

    def _run_batch_inference(
        self,
        batch: list[dict],
        horizon: int,
    ) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], list[dict]]:
        """One predict_df call for the whole batch; split output per item_id."""
        # Build a single long-format frame — one item_id per series in the batch.
        # (The base has already normalised each item's `values` and precomputed
        # hist_X/fut_X for the Ridge covariate path.)
        frames = []
        for i, item in enumerate(batch):
            vals = np.asarray(item["values"], dtype=np.float64)
            ts = pd.date_range(_ANCHOR, periods=len(vals), freq="D")   # regular, gap-free (required)
            frames.append(pd.DataFrame({"item_id": i, "timestamp": ts, "target": vals}))
        long_df = pd.concat(frames, ignore_index=True)

        pred_df = self._pipeline.predict_df(
            long_df,
            id_column="item_id",
            timestamp_column="timestamp",
            target="target",
            prediction_length=horizon,
            quantile_levels=_QUANTILE_LIST,
            # For NATIVE covariates instead of the Ridge path: add covariate columns
            # to long_df (past covariates) and pass future_df=<known-future covariates>,
            # then drop the _residual_ridge_adjustment call below.
        )
        qcols = self._resolve_quantile_columns(pred_df)

        results = []
        ridge_infos = []
        for i, item in enumerate(batch):
            sub = pred_df[pred_df["item_id"] == i].sort_values("timestamp")
            base_quantiles = np.sort(sub[qcols].to_numpy(dtype=np.float64), axis=1)  # (horizon, 9)
            base_pred = base_quantiles[:, 4]     # P50
            base_lower = base_quantiles[:, 0]    # P10
            base_upper = base_quantiles[:, -1]   # P90

            adj, ridge_info = self._residual_ridge_adjustment(item, base_pred, horizon)
            ridge_infos.append(ridge_info)
            results.append((
                _sanitize_nan(base_pred + adj),
                _sanitize_nan(base_lower + adj),
                _sanitize_nan(base_upper + adj),
                _sanitize_nan(base_quantiles + adj[:, np.newaxis]),
            ))

        return results, ridge_infos
