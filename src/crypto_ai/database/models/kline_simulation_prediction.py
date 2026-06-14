"""Per-timestamp prediction rows for a kline simulation run."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.kline_simulation import KlineSimulation


class KlineSimulationPrediction(Base):
    """A single one-step-ahead forecast vs actual within a simulation."""

    __tablename__ = "kline_simulation_prediction"

    simulation_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("kline_simulation.id", ondelete="CASCADE"),
        index=True,
    )
    model_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actual: Mapped[float] = mapped_column(Numeric(precision=20, scale=8), nullable=False)
    predicted: Mapped[float] = mapped_column(Numeric(precision=20, scale=8), nullable=False)
    error: Mapped[float] = mapped_column(Numeric(precision=20, scale=8), nullable=False)
    pct_error: Mapped[float] = mapped_column(Numeric(precision=12, scale=4), nullable=False)

    # The full predictive distribution (P10..P90) and uncertainty-derived fields.
    # Null for engines/runs that produce no quantiles (e.g. statistical, stub).
    prev_close: Mapped[float | None] = mapped_column(Numeric(precision=20, scale=8), nullable=True)
    quantiles: Mapped[list | None] = mapped_column(JSON, nullable=True)
    prob_up: Mapped[float | None] = mapped_column(Numeric(precision=6, scale=4), nullable=True)
    in_interval: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Genuine volatility forecast (opt-in): the model's one-step-ahead forecast of
    # the bar's realized range-volatility ln(high/low), and the value that actually
    # realized. Null unless the run was created with forecast_vol enabled.
    pred_vol: Mapped[float | None] = mapped_column(Numeric(precision=20, scale=10), nullable=True)
    realized_vol: Mapped[float | None] = mapped_column(Numeric(precision=20, scale=10), nullable=True)

    simulation: Mapped["KlineSimulation"] = relationship("KlineSimulation")

    __table_args__ = (
        Index("idx_sim_pred_sim_model_time", "simulation_id", "model_name", "timestamp"),
    )
