"""Prediction model — persisted prediction request and its parameters."""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer
    from crypto_ai.database.models.outlet_group import OutletGroup
    from crypto_ai.database.models.prediction_strategy import PredictionStrategy


class Prediction(Base):
    """Persisted prediction request with all parameters used to generate it."""

    __tablename__ = "predictions"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    prediction_strategy_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_strategies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    outlet_group_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlet_group.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    outlet_ids: Mapped[list[str] | None] = mapped_column(
        ARRAY(UUID(as_uuid=False)),
        nullable=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    delay: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    engine: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_engine: Mapped[str | None] = mapped_column(Text, nullable=True)
    engine_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    use_financials: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    use_pad: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    batch_size: Mapped[int] = mapped_column(Integer, nullable=False, default=32)
    task_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer")
    prediction_strategy: Mapped["PredictionStrategy | None"] = relationship("PredictionStrategy")
    outlet_group: Mapped["OutletGroup | None"] = relationship("OutletGroup")
