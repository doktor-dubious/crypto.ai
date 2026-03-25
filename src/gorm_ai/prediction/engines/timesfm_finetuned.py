"""TimesFM engine loaded from a locally fine-tuned checkpoint."""

import logging
import os

from gorm_ai.prediction.engine import EngineCapabilities
from gorm_ai.prediction.engines.timesfm import TimesFMEngine

logger = logging.getLogger(__name__)


class TimesFMFinetunedEngine(TimesFMEngine):
    """TimesFM 2.5 loaded from a locally fine-tuned checkpoint.

    Inherits all prediction logic from TimesFMEngine (predict, predict_batch,
    Ridge regression, Newsvendor). Only the checkpoint loading differs.

    Falls back to the base HuggingFace checkpoint transparently when the local
    fine-tuned checkpoint directory is missing or fails to load.
    """

    def __init__(self, checkpoint_path: str | None = None):
        super().__init__()
        self._checkpoint_path = checkpoint_path

    def get_capabilities(self) -> EngineCapabilities:
        caps = super().get_capabilities()
        caps.name = "Google TimesFM (fine-tuned)"
        caps.description = "Foundation model fine-tuned on in-domain sales data"
        return caps

    def _load_model(self) -> None:
        from gorm_ai.config import get_settings

        self._apply_hf_env()
        path = self._checkpoint_path or get_settings().finetuned_model_path

        if not os.path.isdir(path):
            logger.warning(
                "Fine-tuned checkpoint not found at '%s' — falling back to base TimesFM", path
            )
            super()._load_model()
            return

        try:
            import timesfm

            self._model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(path)
            self._model.compile(
                timesfm.ForecastConfig(
                    max_context=1024,
                    max_horizon=128,
                    normalize_inputs=True,
                    use_continuous_quantile_head=True,
                    force_flip_invariance=True,
                    infer_is_positive=True,
                    fix_quantile_crossing=True,
                    return_backcast=True,
                )
            )
            logger.info("Fine-tuned TimesFM loaded from '%s'", path)
        except Exception as e:
            logger.warning(
                "Failed to load fine-tuned model from '%s' (%s) — falling back to base TimesFM",
                path, e,
            )
            super()._load_model()
        finally:
            self._model_loaded = True
