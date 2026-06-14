"""Fine-tune log entries stored in the database.

Allows remote workers (e.g. vast.ai) to persist log lines centrally so
the API can serve them regardless of which machine ran the task.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class FinetuneLog(Base):
    """A single log line from a fine-tuning run."""

    __tablename__ = "finetune_logs"

    fine_tune_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("fine_tunes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    level: Mapped[str] = mapped_column(String(20), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    worker_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    logged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )
