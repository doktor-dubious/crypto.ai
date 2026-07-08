"""Schemas for crypto orchestration groups."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

MetricType = Literal["mase", "smase", "mae", "mape", "rmse", "crps"]
# Calibration grain: "pooled" (one weight vector across all series) or "pair"
# (one vector per coin_id:quote_asset). None ≡ "pooled".
GrainType = Literal["pooled", "pair"]


class EngineCompositionItem(BaseModel):
    """Single engine in an orchestration group."""

    engine_slug: str = Field(description="Engine slug")
    engine_name: str = Field(description="Engine name")
    weight: float = Field(ge=0, le=1, description="Normalized weight (0-1)")
    rank: int = Field(ge=1, description="Rank in group (1-based)")


class CreateOrchestrationGroupRequest(BaseModel):
    """Request to create an orchestration group."""

    name: str = Field(description="Name of the orchestration group", min_length=1, max_length=255)
    description: str | None = Field(None, description="Optional description")
    notes: str | None = Field(None, description="Optional free-text notes")
    engine_slugs: list[str] = Field(
        description="List of engine slugs to evaluate", min_length=2, max_length=20,
    )
    metric: MetricType = Field("mase", description="Metric to optimize")
    top_n: int = Field(4, ge=1, le=20, description="Number of top engines to select")
    prediction_target: GrainType | None = Field(
        None, description="Grain to calibrate at: pooled (default) or pair",
    )
    # Calibration universe (which kline series to backtest over).
    quote_asset: str = Field("USDT", description="Quote asset for the calibration universe")
    interval: str = Field("1h", description="Kline interval for the calibration universe")
    coin_ids: list[str] = Field(
        default_factory=list,
        description="Coins to calibrate over (empty = all coins with klines for quote/interval)",
    )
    engine_params: dict[str, dict[str, str]] | None = Field(
        None, description="Per-model parameter overrides {engine_slug: {param_name: value}}.",
    )


class UpdateOrchestrationGroupRequest(BaseModel):
    """Request to update an orchestration group's definition (no recalibration)."""

    name: str | None = Field(None, description="New name")
    description: str | None = Field(None, description="New description")
    notes: str | None = Field(None, description="New notes")
    metric: MetricType | None = Field(None, description="New error metric")
    top_n: int | None = Field(None, ge=1, le=20, description="New Top-N")
    prediction_target: GrainType | None = Field(None, description="New calibration grain")
    quote_asset: str | None = Field(None, description="New quote asset")
    interval: str | None = Field(None, description="New interval")
    coin_ids: list[str] | None = Field(None, description="New coin universe")
    engine_slugs: list[str] | None = Field(
        None, min_length=2, max_length=20, description="New candidate model pool",
    )
    engine_params: dict[str, dict[str, str]] | None = Field(
        None, description="New per-model parameter overrides",
    )


class OrchestrationGroupResponse(BaseModel):
    """Response for an orchestration group."""

    id: str = Field(description="Group ID")
    name: str = Field(description="Group name")
    description: str | None = Field(description="Group description")
    notes: str | None = Field(None, description="Free-text notes")
    model_composition: dict[str, float] = Field(
        description="Dict mapping engine slug to normalized weight"
    )
    top_n: int = Field(description="Number of top engines")
    calibration_metric: str = Field(description="Metric used for calibration")
    prediction_target: str | None = Field(None, description="Grain calibrated at (null=pooled)")
    quote_asset: str = Field(description="Calibration-universe quote asset")
    interval: str = Field(description="Calibration-universe interval")
    coin_ids: list[str] = Field(default_factory=list, description="Calibration-universe coins")
    status: str = Field("draft", description="draft | selecting | reweighting | ready | failed")
    last_calibrated_at: datetime | None = Field(description="Last calibration timestamp")
    last_calibration_score: float | None = Field(description="Last calibration score")
    created_at: datetime = Field(description="Creation timestamp")
    updated_at: datetime = Field(description="Last update timestamp")
    active: bool = Field(description="Whether the group is active")


class OrchestrationGroupDetailResponse(OrchestrationGroupResponse):
    """Detailed response for an orchestration group including engines."""

    engines: list[EngineCompositionItem] = Field(
        description="List of engines in the group with their weights"
    )
    engine_slugs: list[str] = Field(default_factory=list, description="Full candidate engine pool")
    calibrated_slugs: list[str] = Field(
        default_factory=list,
        description="Candidate pool the current composition was selected from",
    )
    calibrated_basis: dict = Field(
        default_factory=dict,
        description=(
            "Config snapshot (slugs/prediction_target/metric/top_n) the current "
            "weights were computed under — staleness = current config differs"
        ),
    )
    engine_workers: dict[str, str] = Field(
        default_factory=dict, description="Per-model worker assignment"
    )
    engine_params: dict[str, dict[str, str]] = Field(
        default_factory=dict, description="Per-model parameter overrides"
    )
    task_id: str | None = Field(
        None, description="Calibration task id (set when calibration was just dispatched)"
    )


class CalibrateGroupRequest(BaseModel):
    """Request to run a calibration op (Selection or Reweight) on a group."""

    engine_workers: dict[str, str] | None = Field(
        None, description="Per-model worker queue assignment for this run"
    )


class CalibrateGroupResponse(BaseModel):
    """Response from a Selection or Reweight dispatch."""

    id: str = Field(description="Group ID")
    task_id: str = Field(description="Calibration task id")
    status: str = Field(default="selecting", description="Group status after dispatch")
