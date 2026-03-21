"""SimulationDate model — links a simulation run to prediction rows used for each date."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.prediction import Prediction
    from gorm_ai.database.models.simulation import Simulation


class SimulationDate(Base):
    """Links a simulation run to a specific prediction row used for a given date."""

    __tablename__ = "simulation_dates"

    simulation_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("simulations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    prediction_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("predictions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Relationships
    simulation: Mapped["Simulation"] = relationship("Simulation")
    prediction: Mapped["Prediction"] = relationship("Prediction")
