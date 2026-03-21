"""LastPrediction model — latest prediction result per outlet per weekday."""

from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, SmallInteger, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.outlet import Outlet
    from gorm_ai.database.models.prediction import Prediction


class LastPrediction(Base):
    """Latest prediction result per outlet per weekday.

    Overwritten on every prediction run. Always reflects the most recent
    prediction for each (outlet_id, weekday) combination.
    """

    __tablename__ = "last_prediction"
    __table_args__ = (
        UniqueConstraint("outlet_id", "weekday", name="uq_last_prediction_outlet_weekday"),
    )

    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    prediction_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("predictions.id", ondelete="CASCADE"),
        nullable=False,
    )
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 1=Monday, 7=Sunday

    predicted: Mapped[float | None] = mapped_column(Float, nullable=True)
    economic_optimal: Mapped[float | None] = mapped_column(Float, nullable=True)
    weekday_correction: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivered: Mapped[float | None] = mapped_column(Float, nullable=True)
    lower_bound: Mapped[float | None] = mapped_column(Float, nullable=True)
    upper_bound: Mapped[float | None] = mapped_column(Float, nullable=True)
    cv: Mapped[float | None] = mapped_column(Float, nullable=True)
    fixed: Mapped[float | None] = mapped_column(Float, nullable=True)
    minimum: Mapped[float | None] = mapped_column(Float, nullable=True)
    maximum: Mapped[float | None] = mapped_column(Float, nullable=True)
    add: Mapped[float | None] = mapped_column(Float, nullable=True)
    add_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    outlet: Mapped["Outlet"] = relationship("Outlet")
    prediction: Mapped["Prediction"] = relationship("Prediction")
