"""System-wide configuration singleton."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.llm import Llm
    from gorm_ai.database.models.llm_submodel import LlmSubmodel
    from gorm_ai.database.models.prediction_engine import PredictionEngine


class Configuration(Base):
    """System-wide configuration singleton."""

    __tablename__ = "configuration"

    peak_period: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    minimum_delivery: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    price_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    profit_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo_to_delivery_rounding: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # 1=round, 2=ceil, 3=floor
    weekday_correction_mon: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weekday_correction_tue: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weekday_correction_wed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weekday_correction_thu: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weekday_correction_fri: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weekday_correction_sat: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weekday_correction_sun: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weekday_only_mon: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekday_only_tue: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekday_only_wed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekday_only_thu: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekday_only_fri: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekday_only_sat: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekday_only_sun: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekday_profile_correction: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekday_profile_correction_strength: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    weekday_profile_correction_threshold: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # 1=additive, 2=multiplicative
    weekday_profile_correction_method: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False,
    )
    covariate_handling: Mapped[str] = mapped_column(
        String(20), default="external", nullable=False,
    )  # none, native, external
    variation_adjustment: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False,
    )
    variation_history_days: Mapped[int] = mapped_column(
        Integer, default=365, nullable=False,
    )
    eo_methodology: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False,
    )  # 1=interpolate, 2=snap to nearest quantile
    eo_extrapolation: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False,
    )  # 1=extrapolate to ~E99, 2=conservative ~E95, 3=cap at E90
    fallback_engine: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    open_monday: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    open_tuesday: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    open_wednesday: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    open_thursday: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    open_friday: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    open_saturday: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    open_sunday: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    simultaneous_tasks: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    periodic_check_workers: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    auto_restart_workers: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    finetuned_model_path: Mapped[str] = mapped_column(
        String(500), default="models/timesfm_finetuned", nullable=False,
    )
    finetune_sync_every: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    prediction_engine_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Insights / Chat
    insights_hidden_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    insight_model_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("llm.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    insight_submodel_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("llm_submodel.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relationships
    prediction_engine: Mapped["PredictionEngine | None"] = relationship("PredictionEngine")
    insight_model: Mapped["Llm | None"] = relationship("Llm")
    insight_submodel: Mapped["LlmSubmodel | None"] = relationship("LlmSubmodel")
