"""PredictionStrategy model for configuring draw optimization strategies."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer
    from gorm_ai.database.models.prediction_engine import PredictionEngine


class PredictionStrategy(Base):
    """Named strategy for adjusting and optimizing prediction draw quantities."""

    __tablename__ = "prediction_strategies"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    prediction_engine_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)  # 1=Economic Optimal
    finetuned_model: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Adjustment fields
    increase_total_by_number: Mapped[float | None] = mapped_column(Float, nullable=True)
    increase_total_by_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    increase_outlets_by_number: Mapped[float | None] = mapped_column(Float, nullable=True)
    increase_outlets_by_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    fixed_total_draw: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_return_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    outlet_return_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Constraint overrides
    ignore_fixed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ignore_minimum: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ignore_maximum: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer", back_populates="prediction_strategies")
    prediction_engine: Mapped["PredictionEngine | None"] = relationship(
        "PredictionEngine",
        primaryjoin="PredictionStrategy.prediction_engine_id == PredictionEngine.id",
        foreign_keys="[PredictionStrategy.prediction_engine_id]",
    )
