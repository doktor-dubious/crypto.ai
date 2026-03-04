"""Customer-level configuration overrides."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer
    from gorm_ai.database.models.prediction_engine import PredictionEngine


class CustomerConfiguration(Base):
    """Customer-level configuration overrides."""

    __tablename__ = "customer_configuration"
    __table_args__ = (
        UniqueConstraint("customer_id", name="uq_customer_configuration_customer_id"),
    )

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    peak_period: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    minimum_delivery: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    profit_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    prediction_engine_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relationships
    customer: Mapped["Customer"] = relationship(
        "Customer",
        back_populates="configuration",
    )
    prediction_engine: Mapped["PredictionEngine | None"] = relationship("PredictionEngine")
