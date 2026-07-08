"""TimesFM engine loaded from a locally fine-tuned checkpoint."""

import logging
import os

from crypto_ai.prediction.engine import EngineCapabilities
from crypto_ai.prediction.engines.timesfm import TimesFMEngine

logger = logging.getLogger(__name__)


class TimesFMFinetunedEngine(TimesFMEngine):
    """TimesFM 2.5 loaded from a locally fine-tuned checkpoint.

    Inherits all prediction logic from TimesFMEngine (predict, predict_batch,
    Ridge regression, Newsvendor). Only the checkpoint loading differs.

    Falls back to the base HuggingFace checkpoint transparently when the local
    fine-tuned checkpoint directory is missing or fails to load.
    """

    # Fine-tunes are written under this base engine's slug (the inference engine
    # is "timesfm_finetuned" but training runs on the "timesfm" engine).
    finetune_source_slug = "timesfm"

    def __init__(self, checkpoint_path: str | None = None, allow_fallback: bool = True):
        super().__init__()
        self._checkpoint_path = checkpoint_path
        self.allow_fallback = allow_fallback

    def configure_checkpoint(self, path: str | None) -> None:
        """Point the engine at a specific fine-tuned checkpoint directory.

        Used to select the per-(coin/pair/timeframe) checkpoint for a forecast.
        If the path differs from the one currently loaded, the cached model is
        dropped so the next predict lazily reloads from the new path (and falls
        back to base TimesFM if that directory is missing).
        """
        if path != self._checkpoint_path:
            self._checkpoint_path = path
            self._model = None
            self._model_loaded = False

    def get_capabilities(self) -> EngineCapabilities:
        caps = super().get_capabilities()
        caps.name = "Google TimesFM (fine-tuned)"
        caps.description = "Foundation model fine-tuned on in-domain data"
        return caps

    def _load_model(self) -> None:
        from crypto_ai.config import get_settings

        self._apply_hf_env()
        path = self._checkpoint_path or get_settings().finetuned_model_path

        if not os.path.isdir(path):
            if not self.allow_fallback:
                raise RuntimeError(
                    f"Fine-tuned checkpoint not found at '{path}' and engine fallback is disabled"
                )
            logger.warning(
                "Fine-tuned checkpoint not found at '%s' — falling back to base TimesFM", path
            )
            super()._load_model()
            return

        try:
            import timesfm

            logger.info("Loading fine-tuned TimesFM from local path: %s", path)
            self._model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(path)
            self._compile_for_context(1024)
            logger.info("Fine-tuned TimesFM loaded from '%s'", path)
        except Exception as e:
            if not self.allow_fallback:
                raise RuntimeError(
                    f"Failed to load fine-tuned model from '{path}' and engine fallback is disabled"
                ) from e
            logger.warning(
                "Failed to load fine-tuned model from '%s' (%s) — falling back to base TimesFM",
                path, e,
            )
            super()._load_model()
        finally:
            self._model_loaded = True
