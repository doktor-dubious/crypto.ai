"""SimulationStrategy model."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, SmallInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer
    from gorm_ai.database.models.prediction_strategy import PredictionStrategy


class SimulationStrategy(Base):
    """Strategy configuration for running simulations."""

    __tablename__ = "simulation_strategies"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    prediction_strategy_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_strategies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 1=by prediction strategy, 2=fixed delivery, 3=same delivery, 4=same sale
    type: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    delay: Mapped[int] = mapped_column(Integer, nullable=False, default=14)

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer")
    prediction_strategy: Mapped["PredictionStrategy | None"] = relationship("PredictionStrategy")
