"""Simulation model — persisted simulation run with arguments and aggregated outcome stats."""

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer
    from gorm_ai.database.models.outlet_group import OutletGroup
    from gorm_ai.database.models.prediction_strategy import PredictionStrategy


class Simulation(Base):
    """Persisted simulation run with all input arguments and aggregated outcome statistics."""

    __tablename__ = "simulations"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
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
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # Stored arguments
    outlet_ids: Mapped[list[str] | None] = mapped_column(ARRAY(UUID(as_uuid=False)), nullable=True)
    simulation_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    simulation_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    delay: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    engine: Mapped[str | None] = mapped_column(String(255), nullable=True)
    engine_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Delivered scenario aggregates
    d_total_delivered: Mapped[int | None] = mapped_column(Integer, nullable=True)
    d_total_sold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    d_total_returned: Mapped[int | None] = mapped_column(Integer, nullable=True)
    d_diff_delivered: Mapped[int | None] = mapped_column(Integer, nullable=True)
    d_diff_return: Mapped[int | None] = mapped_column(Integer, nullable=True)
    d_lost_sale: Mapped[int | None] = mapped_column(Integer, nullable=True)
    d_more_sale: Mapped[float | None] = mapped_column(Float, nullable=True)
    d_g1: Mapped[float | None] = mapped_column(Float, nullable=True)
    d_g2: Mapped[float | None] = mapped_column(Float, nullable=True)
    d_g3: Mapped[float | None] = mapped_column(Float, nullable=True)
    d_g4: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Prediction scenario aggregates
    p_total_delivered: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_total_sold: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_total_returned: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_diff_delivered: Mapped[int | None] = mapped_column(Integer, nullable=True)
    p_diff_return: Mapped[int | None] = mapped_column(Integer, nullable=True)
    p_lost_sale: Mapped[int | None] = mapped_column(Integer, nullable=True)
    p_more_sale: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_g1: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_g2: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_g3: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_g4: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Actual (historical) aggregates — sum of actual_draw and actual_sale from prediction_outlet
    actual_total_delivered: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_total_sale: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_total_returned: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Economic optimal scenario aggregates
    eo_total_delivered: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo_total_sold: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo_total_returned: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo_diff_delivered: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eo_diff_return: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eo_lost_sale: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eo_more_sale: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo_g1: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo_g2: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo_g3: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo_g4: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer")
    prediction_strategy: Mapped["PredictionStrategy | None"] = relationship("PredictionStrategy", lazy="selectin")
    outlet_group: Mapped["OutletGroup | None"] = relationship("OutletGroup", foreign_keys=[outlet_group_id], lazy="selectin")
