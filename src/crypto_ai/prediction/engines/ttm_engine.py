"""IBM TinyTimeMixer (TTM) prediction engine.

Reference implementation for porting into another project (e.g. crypto.ai).
TTM is a compact (~1-5M param) multivariate forecaster from IBM's granite-tsfm
(``tsfm_public``) package — the SAME package as FlowState, so it needs no extra
dependency and runs in the same worker.

Two characteristics drive this integration:
  1. Fixed windows. Each TTM sub-model is pretrained for a specific
     (context_length, prediction_length) pair. ``get_model`` fetches the smallest
     sub-model whose windows cover the request; the context is left-pad/truncated
     to the exact length and the output sliced to the requested horizon.
  2. Point forecaster. TTM emits a point forecast, not quantiles. To keep an
     uncertainty/economic-optimal path working, a Gaussian quantile band is
     synthesised around the point forecast (sigma from first-difference volatility,
     widened with the random-walk rule sigma*sqrt(step)). This is an approximation.

Covariates use the inherited model-agnostic external-Ridge path.

INTEGRATION CHECKLIST:
  1. Fix the ``from crypto_ai.prediction...`` imports to your package name.
  2. Dependency: install the granite-tsfm ``flowstate`` extra (imports as
     ``tsfm_public``) — pins ``transformers<4.51`` (conflicts with yinglong/kairos/
     autogluon/toto/tabpfn → run in an isolated worker).
  3. Register: add ``TTM = "ttm"`` to the engine enum and
     ``self.register(PredictionEngineEnum.TTM, TTMEngine)`` in the registry.
  4. If your engine list is DB-driven, insert a ``prediction_engine`` row with slug
     ``ttm`` (+ optional param rows: ``model=ttm-r2`` selected, ``batch_size`` options).
  5. Default checkpoint is ``ibm-granite/granite-timeseries-ttm-r2`` (confirmed).
     r3 id is NOT yet published — the alias map maps ``r3``/``ttm-r3`` to the
     expected pattern; it will 404 until IBM publishes it. Keep r2 as default.

MODEL PARAMETER (`model`/`submodel`): accepts bare tags ``r1``/``r2``/``r3``,
``ttm-r1/2/3``, the repo name, or a full HF id. Resolution is case-sensitive
(use lowercase).
"""

import logging

import numpy as np

# NOTE: fix these import paths to your project's package name.
from crypto_ai.prediction.engine import EngineCapabilities, MemoryEstimate
from crypto_ai.prediction.engines.chronos_pipeline_engine import (
    ChronosPipelineEngine,
    _sanitize_nan,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "ibm-granite/granite-timeseries-ttm-r2"

# Pretrained window sizes available via get_model (r2 family).
_CONTEXT_OPTIONS = (512, 1024, 1536)
_HORIZON_OPTIONS = (96, 192, 336, 720)

# Standard-normal quantiles for P10..P90, used to synthesise a band around the
# TTM point forecast (TTM has no native quantile head).
_Z_SCORES = np.array(
    [-1.28155, -0.84162, -0.52440, -0.25335, 0.0,
     0.25335, 0.52440, 0.84162, 1.28155]
)

_TTM_AVAILABLE: bool | None = None


def _nearest_geq(value: int, options: tuple[int, ...]) -> int:
    """Smallest option >= value, or the largest option if value exceeds all."""
    for opt in options:
        if opt >= value:
            return opt
    return options[-1]


class TTMEngine(ChronosPipelineEngine):
    """IBM TinyTimeMixer engine — load once per window shape, predict many.

    Sub-models are cached by (context_length, prediction_length) since TTM is
    window-specific. Point forecasts are wrapped in a synthetic Gaussian quantile
    band for the uncertainty / economic-optimal path.
    """

    _MODEL_ALIASES: dict[str, str] = {
        # Long forms
        "ttm-r1": "ibm-granite/granite-timeseries-ttm-r1",
        "ttm-r2": "ibm-granite/granite-timeseries-ttm-r2",
        "ttm-r3": "ibm-granite/granite-timeseries-ttm-r3",
        # Bare release tags (what users naturally type)
        "r1": "ibm-granite/granite-timeseries-ttm-r1",
        "r2": "ibm-granite/granite-timeseries-ttm-r2",
        "r3": "ibm-granite/granite-timeseries-ttm-r3",
        # Repo names
        "granite-timeseries-ttm-r1": "ibm-granite/granite-timeseries-ttm-r1",
        "granite-timeseries-ttm-r2": "ibm-granite/granite-timeseries-ttm-r2",
        "granite-timeseries-ttm-r3": "ibm-granite/granite-timeseries-ttm-r3",
    }
    _DEFAULT_PREFIX = "ibm-granite/"

    _MODEL_PARAMS: dict[str, float] = {
        **ChronosPipelineEngine._MODEL_PARAMS,
        "ibm-granite/granite-timeseries-ttm-r2": 5e6,
        "ibm-granite/granite-timeseries-ttm-r1": 1e6,
    }

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        super().__init__(model_id=model_id, default_precision="float32")
        self._device: str = "cpu"
        self._torch_dtype = None
        self._ttm_cache: dict[tuple[int, int], object] = {}

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="TinyTimeMixer",
            description="IBM TinyTimeMixer compact forecaster (point + synthetic quantiles)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=16,
            max_history_length=_CONTEXT_OPTIONS[-1],
            max_horizon=_HORIZON_OPTIONS[-1],
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def estimate_memory(self, *, task_type: str = "prediction", num_outlets: int = 1,
                        batch_size: int = 8, horizon: int = 30, context_length: int = 512,
                        num_covariates: int = 0, precision: str = "float32",
                        epochs: int = 0) -> MemoryEstimate:
        params = self._MODEL_PARAMS.get(self._model_id, 5e6)
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

    def is_available(self) -> bool:
        return self._check_ttm()

    def _check_ttm(self) -> bool:
        global _TTM_AVAILABLE
        if _TTM_AVAILABLE is None:
            try:
                from tsfm_public.toolkit.get_model import get_model  # noqa: F401
                _TTM_AVAILABLE = True
                logger.info("tsfm_public (TinyTimeMixer) is available")
            except ImportError:
                _TTM_AVAILABLE = False
                logger.warning(
                    "tsfm_public not installed; TinyTimeMixer unavailable, "
                    "falling back to statistical"
                )
        return _TTM_AVAILABLE

    def _load_model(self) -> None:
        """Mark availability and resolve device. Sub-models are loaded lazily per
        (context, horizon) shape in ``_get_ttm``."""
        if self._model_loaded:
            return
        if not self._check_ttm():
            self._model_loaded = True
            return
        self._apply_hf_env()
        try:
            import torch

            dtype_map = {"float32": torch.float32, "bfloat16": torch.bfloat16,
                         "float16": torch.float16}
            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            self._torch_dtype = dtype_map[self._precision]
            # Sentinel so the base predict_batch does not route to statistical.
            self._pipeline = "ttm"
            logger.info("TinyTimeMixer ready: %s (device: %s)", self._model_id, self._device)
        except Exception as e:
            logger.warning("Failed to initialise TinyTimeMixer, falling back to statistical: %s", e)
            self._pipeline = None
        finally:
            self._model_loaded = True

    def _get_ttm(self, context_length: int, prediction_length: int):
        """Fetch (and cache) the TTM sub-model for a given window shape."""
        key = (context_length, prediction_length)
        if key not in self._ttm_cache:
            import torch
            from tsfm_public.toolkit.get_model import get_model

            model = get_model(
                self._model_id,
                context_length=context_length,
                prediction_length=prediction_length,
            )
            model = model.to(device=self._device, dtype=self._torch_dtype).eval()
            self._ttm_cache[key] = model
            logger.info(
                "Loaded TTM sub-model %s (context=%d, horizon=%d, device=%s)",
                self._model_id, context_length, prediction_length, self._device,
            )
            del torch  # keep namespace tidy
        return self._ttm_cache[key]

    # -- batch inference (sync, runs in thread pool) -------------------------

    def _run_batch_inference(
        self,
        batch: list[dict],
        horizon: int,
    ) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], list[dict]]:
        """Run TTM per item: fixed-window forward pass + synthetic quantile band
        + inherited external-Ridge covariate adjustment.
        """
        import torch

        # Pick the smallest pretrained windows that cover this batch/request.
        max_len = max(len(item["values"]) for item in batch)
        context_length = _nearest_geq(max_len, _CONTEXT_OPTIONS)
        prediction_length = _nearest_geq(horizon, _HORIZON_OPTIONS)
        model = self._get_ttm(context_length, prediction_length)

        results = []
        ridge_infos = []
        for item in batch:
            values = np.asarray(item["values"], dtype=np.float64)

            # Left-pad (or truncate) to the exact context length TTM expects.
            ctx = values
            if len(ctx) > context_length:
                ctx = ctx[-context_length:]
            elif len(ctx) < context_length:
                ctx = np.concatenate([np.zeros(context_length - len(ctx)), ctx])

            past = torch.tensor(
                ctx, dtype=self._torch_dtype, device=self._device,
            ).reshape(1, context_length, 1)  # (batch=1, context, channels=1)

            with torch.no_grad():
                out = model(past_values=past)
            # prediction_outputs: (batch=1, prediction_length, channels=1)
            point_full = out.prediction_outputs[0, :, 0].float().cpu().numpy()
            point = point_full[:horizon]

            base_quantiles = self._synthesise_quantiles(values, point, horizon)
            base_pred = base_quantiles[:, 4]    # P50 == point forecast
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

    @staticmethod
    def _synthesise_quantiles(
        values: np.ndarray,
        point: np.ndarray,
        horizon: int,
    ) -> np.ndarray:
        """Build a (horizon, 9) Gaussian quantile band around a point forecast.

        TTM has no quantile head, so uncertainty is approximated from the series'
        recent first-difference volatility, widened per step with the random-walk
        rule (sigma * sqrt(step)). Quantiles are P50 == point.
        """
        if len(values) > 1:
            sigma = float(np.std(np.diff(values)))
        else:
            sigma = float(np.std(values)) if len(values) else 0.0
        if not np.isfinite(sigma) or sigma <= 0:
            sigma = 1e-6
        steps = np.sqrt(np.arange(1, horizon + 1))            # (horizon,)
        spread = sigma * steps[:, None] * _Z_SCORES[None, :]  # (horizon, 9)
        quantiles = point[:, None] + spread                   # (horizon, 9)
        return np.sort(quantiles, axis=1)
