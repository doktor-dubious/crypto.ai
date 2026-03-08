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
    prediction_engine_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relationships
    prediction_engine: Mapped["PredictionEngine | None"] = relationship("PredictionEngine")
