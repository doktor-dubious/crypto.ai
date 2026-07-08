"""Direct Toto 2.0 prediction engine using Datadog's ``toto2`` package.

Reference implementation for porting into another project (e.g. crypto.ai).
Toto 2.0 is a SEPARATE model/distribution from the original Toto
(``Datadog/Toto-Open-Base-1.0``). It ships in its own package (``toto-models``
→ ``import toto2``) so it can be installed alongside the 1.0 engine in an
isolated worker without dependency conflicts.

Unlike Toto 1.0 (Student-T mixture, Monte-Carlo sampling) Toto 2.0 returns the
nine quantile levels directly from ``model.forecast()`` in a single forward pass.
Runs on CPU or GPU.

Toto 2.0 has no native exogenous/covariate API, but this engine inherits the
model-agnostic external-Ridge covariate handling from ``ChronosPipelineEngine``.

INTEGRATION CHECKLIST:
  1. Fix the ``from crypto_ai.prediction...`` imports to your package name.
  2. Dependency: ``toto-models`` (imports as ``toto2``). REQUIRES Python >= 3.12
     — gate it with a marker (``toto-models; python_version >= '3.12'``) and run it
     in a Python 3.12 worker/image. Conflicts with moirai/autogluon/toto/kairos/
     flowstate/yinglong/tabpfn (gluonts pin) → isolated worker.
  3. Register: add ``TOTO2 = "toto2"`` to the engine enum and
     ``self.register(PredictionEngineEnum.TOTO2, Toto2DirectEngine)`` in the registry.
  4. If your engine list is DB-driven, insert a ``prediction_engine`` row with slug
     ``toto2`` (+ optional param rows: ``model=toto-2.0-313m`` selected, precision).
  5. If your elasticity/pricing schema has a "ridge-capable engine" allow-list,
     add ``toto2`` to it (this bit us — 422 errors otherwise).

MODEL PARAMETER (`model`/`submodel`): a size like ``toto-2.0-1b`` or a full HF id.
Checkpoints: ``Datadog/Toto-2.0-{4m,22m,313m,1B,2.5B}``; default 313m.
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

DEFAULT_MODEL_ID = "Datadog/Toto-2.0-313m"

_TOTO2_AVAILABLE: bool | None = None

# Parameter counts per checkpoint for memory estimation.
_TOTO2_PARAMS: dict[str, float] = {
    "Datadog/Toto-2.0-4m": 4e6,
    "Datadog/Toto-2.0-22m": 22e6,
    "Datadog/Toto-2.0-313m": 313e6,
    "Datadog/Toto-2.0-1B": 1e9,
    "Datadog/Toto-2.0-2.5B": 2.5e9,
}


class Toto2DirectEngine(ChronosPipelineEngine):
    """Direct Toto 2.0 engine — load once, predict many.

    Loaded via the ``toto2`` package (``Toto2Model.from_pretrained``). Each batch
    item is forecast independently as a single univariate series; the model
    returns nine quantiles directly, so no sampling is required.
    """

    _MODEL_ALIASES: dict[str, str] = {
        "toto-2.0-4m": "Datadog/Toto-2.0-4m",
        "toto-2.0-22m": "Datadog/Toto-2.0-22m",
        "toto-2.0-313m": "Datadog/Toto-2.0-313m",
        "toto-2.0-1b": "Datadog/Toto-2.0-1B",
        "toto-2.0-2.5b": "Datadog/Toto-2.0-2.5B",
    }
    _DEFAULT_PREFIX = "Datadog/"

    _MODEL_PARAMS: dict[str, float] = {
        **ChronosPipelineEngine._MODEL_PARAMS,
        **_TOTO2_PARAMS,
    }

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        # Default to float32: robust on CPU and avoids mat1/mat2 dtype mismatch.
        # Override via the "precision" DB parameter for GPU bfloat16 inference.
        super().__init__(model_id=model_id, default_precision="float32")
        self._device: str = "cpu"
        self._torch_dtype = None  # set in _load_model()

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Toto 2.0",
            description="Datadog Toto 2.0 foundation model (direct, quantile output)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=4096,
            max_horizon=720,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def estimate_memory(self, *, task_type: str = "prediction", num_outlets: int = 1,
                        batch_size: int = 8, horizon: int = 30, context_length: int = 512,
                        num_covariates: int = 0, precision: str = "float32",
                        epochs: int = 0) -> MemoryEstimate:
        # Single forward pass (no Monte-Carlo sampling); quantiles returned
        # directly. Runs on CPU or GPU, so GPU is not required.
        params = self._MODEL_PARAMS.get(self._model_id, 313e6)
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

    def _check_toto2(self) -> bool:
        global _TOTO2_AVAILABLE
        if _TOTO2_AVAILABLE is None:
            try:
                from toto2 import Toto2Model  # noqa: F401
                _TOTO2_AVAILABLE = True
                logger.info("Datadog toto2 package is available")
            except ImportError:
                _TOTO2_AVAILABLE = False
                logger.warning(
                    "toto2 (toto-models) not installed; Toto 2.0 unavailable, "
                    "falling back to statistical"
                )
        return _TOTO2_AVAILABLE

    def _load_model(self) -> None:
        """Load Toto 2.0 via the toto2 package and cache it."""
        if self._model_loaded:
            return
        if not self._check_toto2():
            self._model_loaded = True
            return
        self._apply_hf_env()
        try:
            import torch
            from toto2 import Toto2Model

            dtype_map = {
                "float32": torch.float32,
                "bfloat16": torch.bfloat16,
                "float16": torch.float16,
            }
            device = "cuda" if torch.cuda.is_available() else "cpu"
            torch_dtype = dtype_map[self._precision]
            logger.info("Downloading/resolving Toto 2.0 from Hugging Face: %s", self._model_id)
            model = Toto2Model.from_pretrained(self._model_id, map_location=device)
            model = model.to(device=device, dtype=torch_dtype).eval()
            self._pipeline = model
            self._device = device
            self._torch_dtype = torch_dtype
            logger.info(
                "Toto 2.0 model loaded: %s (%s, device: %s)",
                self._model_id, self._precision, device,
            )
        except Exception as e:
            logger.warning(
                "Failed to load Toto 2.0 model %s, falling back to statistical: %s",
                self._model_id, e,
            )
            self._pipeline = None
        finally:
            self._model_loaded = True

    # -- batch inference (sync, runs in thread pool) -------------------------

    def _run_batch_inference(
        self,
        batch: list[dict],
        horizon: int,
    ) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], list[dict]]:
        """Run Toto 2.0 inference per item + per-outlet Ridge regression.

        Each item is a single univariate series of shape (batch=1, n_var=1, T).
        ``forecast()`` returns quantiles of shape (9, batch, n_var, horizon) at
        levels [0.1..0.9], so the median (index 4) is the point forecast.
        """
        import torch

        results = []
        ridge_infos = []
        for item in batch:
            values = np.asarray(item["values"], dtype=np.float64)

            # Toto 2.0 expects (batch=1, n_var=1, time). Cast to the model dtype
            # to avoid mat1/mat2 dtype mismatches.
            target = torch.tensor(
                values, dtype=self._torch_dtype, device=self._device,
            ).reshape(1, 1, -1)
            target_mask = torch.ones_like(target, dtype=torch.bool)
            series_ids = torch.zeros(1, 1, dtype=torch.long, device=self._device)

            with torch.no_grad():
                quantiles = self._pipeline.forecast(
                    {"target": target, "target_mask": target_mask, "series_ids": series_ids},
                    horizon=horizon,
                )
            # quantiles shape: (9, batch=1, n_var=1, horizon) → (horizon, 9)
            q = quantiles[:, 0, 0, :].float().cpu().numpy()
            base_quantiles = np.sort(q.T, axis=1)  # enforce monotonic quantiles
            base_pred = base_quantiles[:, 4]    # P50 (median) as point forecast
            base_lower = base_quantiles[:, 0]   # P10
            base_upper = base_quantiles[:, -1]  # P90

            # Model-agnostic Ridge-on-residuals covariate adjustment (base class).
            adj, ridge_info = self._residual_ridge_adjustment(item, base_pred, horizon)
            ridge_infos.append(ridge_info)

            results.append((
                _sanitize_nan(base_pred + adj),
                _sanitize_nan(base_lower + adj),
                _sanitize_nan(base_upper + adj),
                _sanitize_nan(base_quantiles + adj[:, np.newaxis]),
            ))

        return results, ridge_infos
