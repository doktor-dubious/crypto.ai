"""Pad and PadDate models for special-date prediction adjustments."""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer


class Pad(Base):
    """Named set of special dates with prediction adjustment configuration."""

    __tablename__ = "pads"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    historic_days: Mapped[int] = mapped_column(Integer, default=0)  # 0 = all history
    allow_negative: Mapped[bool] = mapped_column(Boolean, default=True)
    boost: Mapped[float] = mapped_column(Float, default=0.0)      # fixed copy adjustment
    boost_pct: Mapped[float] = mapped_column(Float, default=0.0)  # percentage adjustment

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer", back_populates="pads")
    dates: Mapped[list["PadDate"]] = relationship(
        "PadDate",
        back_populates="pad",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class PadDate(Base):
    """A specific date belonging to a Pad."""

    __tablename__ = "pad_dates"

    pad_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("pads.id", ondelete="CASCADE"),
        index=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)

    # Relationships
    pad: Mapped["Pad"] = relationship("Pad", back_populates="dates")
