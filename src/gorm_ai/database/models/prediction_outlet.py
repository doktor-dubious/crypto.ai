"""PredictionOutlet model — per-outlet results for a prediction."""

from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.outlet import Outlet
    from gorm_ai.database.models.prediction import Prediction


class PredictionOutlet(Base):
    """Per-outlet result row for a prediction."""

    __tablename__ = "prediction_outlets"

    prediction_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("predictions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Forecast values
    delivered: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo: Mapped[float | None] = mapped_column(Float, nullable=True)       # economic optimal
    predicted: Mapped[float | None] = mapped_column(Float, nullable=True)
    lower_bound: Mapped[float | None] = mapped_column(Float, nullable=True)
    upper_bound: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Quantile forecasts (P20–P80; P10=lower_bound, P90=upper_bound)
    q20: Mapped[float | None] = mapped_column(Float, nullable=True)
    q30: Mapped[float | None] = mapped_column(Float, nullable=True)
    q40: Mapped[float | None] = mapped_column(Float, nullable=True)
    q50: Mapped[float | None] = mapped_column(Float, nullable=True)
    q60: Mapped[float | None] = mapped_column(Float, nullable=True)
    q70: Mapped[float | None] = mapped_column(Float, nullable=True)
    q80: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Per-weekday coefficient of variation (variation adjustment)
    cv: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Actuals (populated from sales table at prediction time, if data exists)
    actual_sale: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Weekday Ridge correction coefficients (from residual correction model)
    correction_mon: Mapped[float | None] = mapped_column(Float, nullable=True)
    correction_tue: Mapped[float | None] = mapped_column(Float, nullable=True)
    correction_wed: Mapped[float | None] = mapped_column(Float, nullable=True)
    correction_thu: Mapped[float | None] = mapped_column(Float, nullable=True)
    correction_fri: Mapped[float | None] = mapped_column(Float, nullable=True)
    correction_sat: Mapped[float | None] = mapped_column(Float, nullable=True)
    correction_sun: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Delivery constraints (from outlet_deliveries or strategy overrides)
    fixed: Mapped[float | None] = mapped_column(Float, nullable=True)
    minimum: Mapped[float | None] = mapped_column(Float, nullable=True)
    maximum: Mapped[float | None] = mapped_column(Float, nullable=True)
    add: Mapped[float | None] = mapped_column(Float, nullable=True)
    add_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    prediction: Mapped["Prediction"] = relationship("Prediction")
    outlet: Mapped["Outlet"] = relationship("Outlet")
