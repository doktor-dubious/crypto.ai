"""PredefinedPad and PredefinedPadDate models."""

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base


class PredefinedPad(Base):
    """A global, customer-independent set of special dates."""

    __tablename__ = "predefined_pad"

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    country: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    allow_negative: Mapped[bool] = mapped_column(Boolean, default=True)

    dates: Mapped[list["PredefinedPadDate"]] = relationship(
        "PredefinedPadDate",
        back_populates="predefined_pad",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class PredefinedPadDate(Base):
    """A specific date belonging to a PredefinedPad."""

    __tablename__ = "predefined_pad_date"

    predefined_pad_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("predefined_pad.id", ondelete="CASCADE"),
        index=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)

    predefined_pad: Mapped["PredefinedPad"] = relationship(
        "PredefinedPad", back_populates="dates"
    )
