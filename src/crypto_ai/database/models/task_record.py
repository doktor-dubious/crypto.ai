"""Task record model for tracking async Celery tasks."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer


class TaskRecord(Base):
    """Tracks async Celery task metadata in the database."""

    __tablename__ = "task_records"

    task_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    customer_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_message: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    worker_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    peak_memory_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    request_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Relationships
    customer: Mapped["Customer | None"] = relationship("Customer", lazy="noload")

    __table_args__ = (
        Index("ix_task_records_status", "status"),
        Index("ix_task_records_type", "type"),
    )
