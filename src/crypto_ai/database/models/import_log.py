"""Import log model — records when files from the upload directory are imported."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer
    from crypto_ai.database.models.import_template import ImportTemplate


class ImportLog(Base):
    """One row per file import attempt."""

    __tablename__ = "import_logs"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    template_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("import_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20), default="pending", server_default="pending", nullable=False
    )
    rows_imported: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    imported_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, server_default=func.now()
    )

    customer: Mapped["Customer"] = relationship("Customer")
    template: Mapped["ImportTemplate | None"] = relationship("ImportTemplate")
