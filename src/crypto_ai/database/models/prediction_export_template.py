"""Prediction export template models."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer


class PredictionExportTemplate(Base):
    """Template defining how prediction results are exported."""

    __tablename__ = "prediction_export_templates"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    header_lines: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    footer_lines: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    footer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    separator: Mapped[str] = mapped_column(String(16), default=",", server_default="','", nullable=False)
    field_length: Mapped[str] = mapped_column(
        String(16), default="variable", server_default="'variable'", nullable=False
    )  # 'variable' or 'fixed'
    character_set: Mapped[str] = mapped_column(
        String(32), default="utf-8", server_default="'utf-8'", nullable=False
    )
    send_to_download: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    send_to_ftp: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    send_to_email: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer")
    elements: Mapped[list["PredictionExportTemplateElement"]] = relationship(
        "PredictionExportTemplateElement",
        back_populates="template",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="PredictionExportTemplateElement.id",
    )


class PredictionExportTemplateElement(Base):
    """A single field/column definition within a prediction export template."""

    __tablename__ = "prediction_export_template_elements"

    template_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_export_templates.id", ondelete="CASCADE"),
        index=True,
    )
    fixed_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prepend_filler_char: Mapped[str | None] = mapped_column(String(8), nullable=True)
    append_filler_char: Mapped[str | None] = mapped_column(String(8), nullable=True)
    date_format: Mapped[str] = mapped_column(
        String(32), default="MM/DD/YYYY", server_default="'MM/DD/YYYY'", nullable=False
    )
    text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    template: Mapped["PredictionExportTemplate"] = relationship(
        "PredictionExportTemplate", back_populates="elements"
    )
