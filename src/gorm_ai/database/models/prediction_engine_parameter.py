"""Prediction engine parameter model."""

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from gorm_ai.database.base import Base


class PredictionEngineParameter(Base):
    """Available parameter value for a prediction engine.

    When ``prediction_strategy_id`` is NULL the parameter belongs to the engine
    globally.  When set, the parameter is scoped to that prediction strategy and
    takes precedence over engine-level parameters with the same name.
    """

    __tablename__ = "prediction_engine_parameter"
    __table_args__ = (
        UniqueConstraint(
            "prediction_engine_id", "prediction_strategy_id", "name", "value",
            name="uq_engine_strategy_param_name_value",
        ),
    )

    prediction_engine_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    prediction_strategy_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_strategies.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    parameter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
