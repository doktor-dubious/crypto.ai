"""Fine-tune progress tracking model."""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class FinetuneProgress(Base):
    """Tracks which outlets have been fine-tuned for each engine.

    One row per (outlet, engine) pair.  When the fine-tuning script
    processes an outlet it inserts a row here so that a subsequent
    (or restarted) run can skip already-completed outlets.
    """

    __tablename__ = "finetune_progress"
    __table_args__ = (
        UniqueConstraint("outlet_id", "engine", name="uq_finetune_progress_outlet_engine"),
    )

    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        index=True,
    )
    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    engine: Mapped[str] = mapped_column(String(50), index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    context_length: Mapped[int] = mapped_column(Integer)
    horizon: Mapped[int] = mapped_column(Integer)
    epochs: Mapped[int] = mapped_column(Integer)
    data_start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    data_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
