"""System-wide configuration singleton."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.prediction_engine import PredictionEngine


class Configuration(Base):
    """System-wide configuration singleton."""

    __tablename__ = "configuration"

    peak_period: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    minimum_delivery: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
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
    simultaneous_tasks: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    periodic_check_workers: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    auto_restart_workers: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    prediction_engine_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relationships
    prediction_engine: Mapped["PredictionEngine | None"] = relationship("PredictionEngine")
