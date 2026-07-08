"""Resolve where per-target fine-tuned checkpoints live.

Crypto fine-tuning produces a separate checkpoint per (coin, trading pair,
timeframe) so a 1h BTCUSDT model and a 30m BTCUSDT model don't overwrite each
other.  The fine-tune *writer* and the inference *reader* must agree on the
exact directory, so both go through these helpers.

The base dir is keyed by the *fine-tune source* engine slug (e.g. ``timesfm``),
not the inference engine slug (``timesfm_finetuned``): fine-tuning the
``timesfm`` engine writes under ``models/finetune/timesfm`` and the
``timesfm_finetuned`` inference engine reads from the same place.
"""

import os

# Root for all fine-tuned checkpoints (relative to the worker's CWD, /app in
# Docker, where ./models is bind-mounted).
FINETUNE_ROOT = os.path.join("models", "finetune")


def finetune_base_dir(slug: str) -> str:
    """Base checkpoint dir for an engine's fine-tunes, e.g. models/finetune/timesfm."""
    return os.path.join(FINETUNE_ROOT, slug)


def finetune_target_subdir(
    coin_id: str | None = None,
    quote_asset: str | None = None,
    interval: str | None = None,
) -> str | None:
    """Per-target subdirectory name, or None when there's no crypto target.

    The same suffix namespaces both the local checkpoint dir and the remote
    sync destination so a fine-tune and its sync land in matching places.
    """
    if coin_id and quote_asset and interval:
        return f"{coin_id}_{quote_asset}_{interval}"
    return None


def finetune_checkpoint_dir(
    slug: str,
    coin_id: str | None = None,
    quote_asset: str | None = None,
    interval: str | None = None,
) -> str:
    """Per-(coin/pair/timeframe) checkpoint dir under the engine's base dir.

    When the full crypto target is given the checkpoint is namespaced so each
    coin/pair/timeframe trains and loads its own model.  With no target (the
    legacy sales fine-tune) the base dir is returned unchanged.
    """
    base = finetune_base_dir(slug)
    sub = finetune_target_subdir(coin_id, quote_asset, interval)
    return os.path.join(base, sub) if sub else base
