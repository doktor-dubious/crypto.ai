"""System-wide configuration singleton."""

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from gorm_ai.database.base import Base


class Configuration(Base):
    """System-wide configuration singleton."""

    __tablename__ = "configuration"

    peak_period: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    minimum_delivery: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    default_prediction_engine: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )
