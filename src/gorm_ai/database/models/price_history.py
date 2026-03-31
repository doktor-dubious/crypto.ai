"""PriceHistory model — tracks historical cost/profit changes over time."""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, Float, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer


class PriceHistory(Base):
    """Historical price timeline for a customer.

    Each row records the cost_per_unit and/or profit_per_unit that took effect
    on ``effective_date``.  When building covariates for predictions the system
    looks up the most recent entry with ``effective_date <= target_date`` so
    that historical dates use the prices that were actually in effect rather
    than today's static values.
    """

    __tablename__ = "price_history"
    __table_args__ = (
        UniqueConstraint(
            "customer_id", "effective_date",
            name="uq_price_history_customer_date",
        ),
    )

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    cost_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    profit_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer", back_populates="price_history")
