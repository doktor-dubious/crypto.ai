"""Prediction engine parameter model."""

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from gorm_ai.database.base import Base


class PredictionEngineParameter(Base):
    """Available parameter value for a prediction engine."""

    __tablename__ = "prediction_engine_parameter"
    __table_args__ = (
        UniqueConstraint(
            "prediction_engine_id", "name", "value",
            name="uq_engine_param_name_value",
        ),
    )

    prediction_engine_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    parameter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
