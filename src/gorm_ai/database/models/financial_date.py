"""FinancialDate and OutletFinancialDate models for date-based financial overrides."""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, Float, ForeignKey, Integer, SmallInteger, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer


class FinancialDate(Base):
    """Per-date configuration for overriding outlet financials."""

    __tablename__ = "financial_dates"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    method: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    copy_from_weekday: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)  # 1-7

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer", back_populates="financial_dates")
    outlet_financial_dates: Mapped[list["OutletFinancialDate"]] = relationship(
        "OutletFinancialDate",
        back_populates="financial_date",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class OutletFinancialDate(Base):
    """Per-outlet cost/profit override for a FinancialDate."""

    __tablename__ = "outlet_financial_dates"

    financial_date_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("financial_dates.id", ondelete="CASCADE"),
        index=True,
    )
    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        index=True,
    )
    price_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    profit_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    financial_date: Mapped["FinancialDate"] = relationship(
        "FinancialDate",
        back_populates="outlet_financial_dates",
    )
