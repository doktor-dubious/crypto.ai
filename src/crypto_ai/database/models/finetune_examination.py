"""Finetune examination model — compares base vs finetuned model simulations."""

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer
    from crypto_ai.database.models.simulation import Simulation


class FinetuneExamination(Base):
    """Persisted finetune examination comparing base vs finetuned model simulations."""

    __tablename__ = "finetune_examinations"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Config used
    simulation_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    simulation_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    delay: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    outlet_group_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlet_group.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    prediction_strategy_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_strategies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    base_engine: Mapped[str | None] = mapped_column(String(255), nullable=True)
    finetuned_engine: Mapped[str | None] = mapped_column(String(255), nullable=True)
    finetuned_model: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Linked simulations (created by the examination)
    base_simulation_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("simulations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    finetuned_simulation_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("simulations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Status
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # Comparison results (stored as JSON for flexibility)
    base_stats: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    finetuned_stats: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    base_zero_shot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    finetuned_zero_shot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    base_overview: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    finetuned_overview: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    conclusion: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer")
    base_simulation: Mapped["Simulation | None"] = relationship(
        "Simulation", foreign_keys=[base_simulation_id]
    )
    finetuned_simulation: Mapped["Simulation | None"] = relationship(
        "Simulation", foreign_keys=[finetuned_simulation_id]
    )
