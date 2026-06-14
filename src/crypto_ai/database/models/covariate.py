"""Covariate models — stores Ridge regression coefficients per outlet per prediction run."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.outlet import Outlet
    from crypto_ai.database.models.pad import Pad


class Covariate(Base):
    """Definition of a covariate feature used in Ridge regression.

    Types:
      - weekday:   day-of-week one-hot dummy (dow_1..dow_6; Sunday is reference)
      - financial: per-unit financial metric (cost_per_unit, profit_per_unit)
      - pad:       binary event indicator for a named PAD set
      - intercept: Ridge intercept (systematic bias absorbed per outlet)
    """

    __tablename__ = "covariates"

    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)  # weekday|financial|pad|intercept
    pad_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("pads.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    pad: Mapped["Pad | None"] = relationship("Pad")
    outlet_coefficients: Mapped[list["CovariateOutlet"]] = relationship(
        "CovariateOutlet", back_populates="covariate", cascade="all, delete-orphan"
    )


class CovariateOutlet(Base):
    """Ridge regression coefficient for one covariate, one outlet, one prediction run."""

    __tablename__ = "covariate_outlet"

    covariate_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("covariates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 1=Monday, 7=Sunday; null for non-weekday covariates (intercept, financial, pad)
    weekday: Mapped[int | None] = mapped_column(SmallInteger, nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    coefficient: Mapped[float] = mapped_column(Float, nullable=False)

    covariate: Mapped["Covariate"] = relationship("Covariate", back_populates="outlet_coefficients")
    outlet: Mapped["Outlet"] = relationship("Outlet")
