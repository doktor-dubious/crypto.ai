"""Time-based prediction adjustments for outlet groups."""

from typing import TYPE_CHECKING

from sqlalchemy import Date, Float, ForeignKey, SmallInteger, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.outlet_group import OutletGroup


class PredictionAdjustment(Base):
    """Time-based prediction adjustments for outlet groups."""

    __tablename__ = "prediction_adjustment"

    group_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlet_group.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    date: Mapped[str] = mapped_column(Date, nullable=False)
    type: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)

    # Relationships
    group: Mapped["OutletGroup"] = relationship(
        "OutletGroup",
        back_populates="prediction_adjustments",
    )
