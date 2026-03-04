"""Prediction engine registry."""

from sqlalchemy import String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from gorm_ai.database.base import Base


class PredictionEngine(Base):
    """Registered prediction engine."""

    __tablename__ = "prediction_engine"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_prediction_engine_slug"),
    )

    slug: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
