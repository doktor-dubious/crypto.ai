"""Fine-tune tracking records."""

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.coin import Coin
    from crypto_ai.database.models.customer import Customer
    from crypto_ai.database.models.outlet_group import OutletGroup
    from crypto_ai.database.models.prediction_engine import PredictionEngine


class FineTune(Base):
    """Tracks individual fine-tuning runs."""

    __tablename__ = "fine_tunes"

    # Legacy sales-based finetuning targeted a customer/outlet-group; crypto
    # kline finetuning targets a coin/pair/timeframe instead, so both are
    # optional and only one set is populated per run.
    customer_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    coin_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("coin.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    quote_asset: Mapped[str | None] = mapped_column(String(10), nullable=True)
    interval: Mapped[str | None] = mapped_column(String(10), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    end_condition: Mapped[str | None] = mapped_column(
        String(50), nullable=True,
    )  # completed, stopped, cancelled, worker_terminated, error
    outlet_group_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlet_group.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    finetune_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    finetune_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    finetuned_outlets: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False,
    )
    pathological_outlets: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False,
    )
    worker_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True,
    )
    prediction_engine_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    task_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True,
    )

    # Relationships
    customer: Mapped["Customer | None"] = relationship("Customer")
    coin: Mapped["Coin | None"] = relationship("Coin", lazy="selectin")
    outlet_group: Mapped["OutletGroup | None"] = relationship(
        "OutletGroup", lazy="selectin",
    )
    prediction_engine: Mapped["PredictionEngine | None"] = relationship(
        "PredictionEngine", lazy="selectin",
    )
