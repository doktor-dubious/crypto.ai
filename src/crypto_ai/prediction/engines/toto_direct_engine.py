"""Direct Toto prediction engine using Datadog's `toto-ts` package.

Loads the Datadog Toto model once via the official ``toto`` package and reuses
it across all prediction calls.  Toto is a 151M parameter foundation model
trained on 1T+ data points from Datadog's observability platform.

We cannot use ``chronos-forecasting``'s ``BaseChronosPipeline`` because it goes
through HuggingFace ``AutoConfig``, which doesn't recognise Toto's custom
``model_type``.  Instead we load Toto directly via ``Toto.from_pretrained()``
and run inference through ``TotoForecaster``.

Inherits preprocessing, Ridge covariate handling, weekday profile correction,
and economic optimal computation from ``ChronosPipelineEngine``.

Requires a CUDA-compatible GPU; falls back to StatisticalEngine without one.
"""

import logging

import numpy as np

from crypto_ai.prediction.engine import EngineCapabilities
from crypto_ai.prediction.engines.chronos_pipeline_engine import (
    _QUANTILE_LEVELS,
    BATCH_SIZE,
    ChronosPipelineEngine,
    _sanitize_nan,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "Datadog/Toto-Open-Base-1.0"

_TOTO_AVAILABLE: bool | None = None
_CUDA_AVAILABLE: bool | None = None


def _check_cuda() -> bool:
    global _CUDA_AVAILABLE
    if _CUDA_AVAILABLE is None:
        try:
            import torch

            _CUDA_AVAILABLE = torch.cuda.is_available()
        except ImportError:
            _CUDA_AVAILABLE = False
    return _CUDA_AVAILABLE


class TotoDirectEngine(ChronosPipelineEngine):
    """Direct Toto engine — load once, predict many.

    Datadog Toto (Time-Series-Optimized Transformer for Observability) is a
    151M parameter model trained on 1T+ data points.  Loaded directly via the
    ``toto-ts`` package, bypassing both AutoGluon and chronos-forecasting.

    Toto produces sample paths which are aggregated into P10–P90 quantile
    forecasts.  Each batch item is processed as a separate forward pass to
    avoid uncertain ``id_mask`` semantics for independent series.

    Requires CUDA; falls back to StatisticalEngine on CPU-only machines.
    """

    _MODEL_ALIASES: dict[str, str] = {
        "toto-open-base": "Datadog/Toto-Open-Base-1.0",
        "toto-open-base-1.0": "Datadog/Toto-Open-Base-1.0",
    }
    _DEFAULT_PREFIX = "Datadog/"

    def __init__(self, model_id: str = DEFAULT_MODEL_ID):
        # Toto's Categorical output head is precision-sensitive: bfloat16 sums
        # of the per-bin probabilities don't exactly equal 1.0, which fails
        # torch.distributions.Categorical's Simplex constraint.  Default to
        # float32; users can still override via the "precision" DB parameter.
        super().__init__(model_id=model_id, default_precision="float32")
        self._forecaster = None
        self._device: str = "cpu"
        self._torch_dtype = None  # set in _load_model()

    def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="Toto",
            description="Datadog Toto foundation model (direct, GPU required)",
            supports_multivariate=True,
            supports_exogenous=True,
            supports_uncertainty=True,
            min_history_length=5,
            max_history_length=4096,
            max_horizon=720,
            supported_frequencies=["daily", "weekly", "monthly"],
        )

    def get_actual_slug(self) -> str | None:
        if not _check_cuda():
            return "statistical"
        if self._model_loaded and self._pipeline is None:
            return "statistical"
        return None

    # -- model loading -------------------------------------------------------

    def is_available(self) -> bool:
        return self._check_toto()

    def _check_toto(self) -> bool:
        global _TOTO_AVAILABLE
        if _TOTO_AVAILABLE is None:
            try:
                from toto.model.toto import Toto  # noqa: F401
                _TOTO_AVAILABLE = True
                logger.info("Datadog toto-ts package is available")
            except ImportError:
                _TOTO_AVAILABLE = False
                logger.warning(
                    "toto-ts not installed; Toto unavailable, falling back to statistical"
                )
        return _TOTO_AVAILABLE

    def _load_model(self) -> None:
        """Load Toto via Datadog's toto package and cache it."""
        if self._model_loaded:
            return
        if not self._check_toto():
            self._model_loaded = True
            return
        self._apply_hf_env()
        try:
            import torch
            from toto.inference.forecaster import TotoForecaster
            from toto.model.toto import Toto

            dtype_map = {
                "float32": torch.float32,
                "bfloat16": torch.bfloat16,
                "float16": torch.float16,
            }
            device = "cuda" if torch.cuda.is_available() else "cpu"
            torch_dtype = dtype_map[self._precision]
            logger.info("Downloading/resolving Toto model from Hugging Face: %s", self._model_id)
            model = Toto.from_pretrained(self._model_id)
            model.to(device, dtype=torch_dtype)
            model.eval()
            self._pipeline = model
            self._forecaster = TotoForecaster(model.model)
            self._device = device
            self._torch_dtype = torch_dtype
            logger.info(
                "Toto model loaded: %s (%s, device: %s)",
                self._model_id, self._precision, device,
            )
        except Exception as e:
            logger.warning(
                "Failed to load Toto model %s, falling back to statistical: %s",
                self._model_id, e,
            )
            self._pipeline = None
            self._forecaster = None
        finally:
            self._model_loaded = True

    # -- batch inference (sync, runs in thread pool) -------------------------

    def _run_batch_inference(
        self,
        batch: list[dict],
        horizon: int,
    ) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], list[dict]]:
        """Run Toto inference per item + per-outlet Ridge regression.

        Each batch item is processed as an independent single-variate forecast
        because the semantics of ``MaskedTimeseries.id_mask`` for unrelated
        series are not documented in the Toto README.  Single-item forwards
        guarantee correctness; performance is GPU-bound and acceptable.

        Returns:
          - list of (predictions, lower, upper, all_quantiles) tuples (normalised)
          - list of ridge_info dicts
        """
        import torch
        from sklearn.linear_model import Ridge
        from toto.data.util.dataset import MaskedTimeseries

        results = []
        ridge_infos = []
        for item in batch:
            values = item["values"]
            hist_X = item["hist_X"]
            fut_X = item["fut_X"]

            # Toto expects (variates, time_steps).  Single univariate series → (1, T).
            # Cast series to the model's dtype to avoid mat1/mat2 dtype mismatch.
            series_np = np.asarray(values, dtype=np.float32).reshape(1, -1)
            series_tensor = torch.tensor(
                series_np, dtype=self._torch_dtype, device=self._device,
            )
            inputs = MaskedTimeseries(
                series=series_tensor,
                padding_mask=torch.full(
                    series_tensor.shape, True, dtype=torch.bool, device=self._device,
                ),
                id_mask=torch.zeros(
                    series_tensor.shape, dtype=torch.long, device=self._device,
                ),
                timestamp_seconds=torch.zeros(
                    series_tensor.shape, dtype=torch.long, device=self._device,
                ),
                time_interval_seconds=torch.full(
                    (1,), 86400, dtype=torch.long, device=self._device,
                ),
            )

            with torch.no_grad():
                forecast = self._forecaster.forecast(
                    inputs,
                    prediction_length=horizon,
                    num_samples=self._num_samples,
                    samples_per_batch=self._num_samples,
                )
            # forecast.samples shape: (batch=1, variate=1, horizon, num_samples)
            # Squeeze batch+variate, then transpose to (num_samples, horizon)
            # to match the layout the rest of this code expects.
            outlet_samples = forecast.samples[0, 0].float().cpu().numpy().T

            base_pred = np.median(outlet_samples, axis=0)
            base_quantiles = np.quantile(
                outlet_samples, _QUANTILE_LEVELS, axis=0
            ).T  # (horizon, 9)
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
                _sanitize_nan(base_pred + adj),
                _sanitize_nan(base_lower + adj),
                _sanitize_nan(base_upper + adj),
                _sanitize_nan(base_quantiles + adj[:, np.newaxis]),
            ))

        return results, ridge_infos

    # -- predict_batch override (skip CUDA early-exit, defer to base) --------

    async def predict_batch(
        self,
        items: list[dict],
        horizon: int,
        prediction_from,
        batch_size: int = BATCH_SIZE,
        holding_rate: float = 0.25,
        protection_days: int = 7,
    ) -> list[list]:
        if not _check_cuda():
            if not self.allow_fallback:
                raise RuntimeError("Toto requires CUDA and engine fallback is disabled")
            from crypto_ai.prediction.engines.statistical import StatisticalEngine

            logger.warning("Toto requires CUDA; falling back to StatisticalEngine")
            return await StatisticalEngine().predict_batch(
                items, horizon, prediction_from, batch_size
            )
        return await super().predict_batch(
            items, horizon, prediction_from, batch_size,
            holding_rate, protection_days,
        )
