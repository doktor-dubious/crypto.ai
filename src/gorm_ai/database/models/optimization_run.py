"""Optimization run model — persisted optimization grid-search with parameters and results."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from gorm_ai.database.models.prediction_engine import PredictionEngine

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base


class OptimizationRun(Base):
    """Persisted optimization run with input parameters and result data."""

    __tablename__ = "optimization_runs"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    task_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="pending", server_default="pending")

    # What was optimized
    optimize_variation_adjustment: Mapped[bool] = mapped_column(Boolean, default=False)
    optimize_eo_methodology: Mapped[bool] = mapped_column(Boolean, default=False)
    optimize_eo_extrapolation: Mapped[bool] = mapped_column(Boolean, default=False)
    optimize_covariate_handling: Mapped[bool] = mapped_column(Boolean, default=False)
    optimize_covariate_types: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    optimize_weekday_profile_correction: Mapped[bool] = mapped_column(Boolean, default=False)

    # Simulation parameters
    simulation_days: Mapped[int] = mapped_column(Integer, default=180)
    delay: Mapped[int] = mapped_column(Integer, default=1)
    prediction_engine_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="SET NULL"),
        nullable=True,
    )
    outlet_group_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlet_group.id", ondelete="SET NULL"),
        nullable=True,
    )
    simulation_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    simulation_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Results (JSON)
    results: Mapped[list | None] = mapped_column(JSON, nullable=True)
    best_combination: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    best_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    total_combinations: Mapped[int] = mapped_column(Integer, default=0)
    completed_combinations: Mapped[int] = mapped_column(Integer, default=0)

    # Diagnostic analyses computed from the best simulation
    diagnostics: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    prediction_engine: Mapped["PredictionEngine | None"] = relationship(
        "PredictionEngine", foreign_keys=[prediction_engine_id], lazy="joined",
    )
