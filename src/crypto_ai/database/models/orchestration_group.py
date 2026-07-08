"""OrchestrationGroup model for crypto model orchestration.

A group is a named, GLOBAL (non-tenant) ensemble of forecasting engines whose
blend weights are calibrated by a rolling-origin walk-forward backtest over a
universe of kline series.  Unlike the retail heritage stack there is no
customer scoping; the "series" is a ``(coin_id, quote_asset, interval)`` triple
and the calibration grain is either ``pooled`` (one vector over all series) or
``pair`` (a vector per ``coin_id:quote_asset``).
"""

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class OrchestrationGroup(Base):
    """Named group of orchestrated forecasting engines (global, not tenant-scoped)."""

    __tablename__ = "orchestration_groups"
    __table_args__ = (
        UniqueConstraint("name", name="uq_orchestration_group_name"),
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The full candidate engine pool the group was created from, so recalibration
    # re-evaluates every candidate (not just the survivors in model_composition).
    engine_slugs: Mapped[list] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )

    # Snapshot of the candidate pool the current model_composition was actually
    # selected from (set on Selection, untouched by Reweight). When engine_slugs
    # drifts from this, the composition is stale and needs re-selection.
    calibrated_slugs: Mapped[list] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )

    # Full config snapshot the current weights were computed under:
    # {"slugs": [...], "prediction_target": ..., "metric": ..., "top_n": ...}.
    # Refreshed on every calibration; weights are stale whenever the group's
    # current config differs from this.
    calibrated_basis: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default=text("'{}'")
    )

    # Per-model worker assignment: {engine_slug: worker_queue}. A model with no
    # entry runs on the default queue.
    engine_workers: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default=text("'{}'")
    )

    # Per-model parameter overrides: {engine_slug: {param_name: value}}. Applied
    # to each engine at calibration and prediction time (engine.apply_parameters).
    engine_params: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default=text("'{}'")
    )

    # Model composition: {engine_slug: weight, ...} — the group-level default
    # weight vector, applied to any series without a per-key entry.
    model_composition: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default=text("'{}'")
    )

    # Per-key weight vectors: {grain_key: {engine_slug: weight, ...}}. Populated
    # for the "pair" grain (grain_key = "coin_id:quote_asset"); empty for the
    # "pooled" grain (everyone uses model_composition).
    weights_by_key: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default=text("'{}'")
    )

    # -- calibration universe (which kline series to backtest over) ----------
    # The quote asset + interval are fixed per group; coin_ids selects the coins
    # (empty list = every active coin that has enough klines).
    quote_asset: Mapped[str] = mapped_column(
        String(10), nullable=False, default="USDT", server_default=text("'USDT'")
    )
    interval: Mapped[str] = mapped_column(
        String(10), nullable=False, default="1h", server_default=text("'1h'")
    )
    coin_ids: Mapped[list] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )

    # Configuration for calibration
    top_n: Mapped[int] = mapped_column(Integer, nullable=False, default=4, server_default=text("4"))
    calibration_metric: Mapped[str] = mapped_column(
        String(32), nullable=False, default="mase", server_default=text("'mase'")
    )

    # Grain the weights are calibrated at. None ≡ "pooled" (single vector over all
    # series); "pair" = one vector per "coin_id:quote_asset" key.
    prediction_target: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Calibration tracking. status: "draft" | "selecting" | "reweighting" | "ready" | "failed".
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="draft", server_default=text("'draft'")
    )
    last_calibrated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_calibration_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Audit
    created_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
