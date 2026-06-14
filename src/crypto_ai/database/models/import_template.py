"""Import template models."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer


class ImportTemplate(Base):
    """Template defining how data files are imported."""

    __tablename__ = "import_templates"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    move_file: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    header_lines: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    footer_lines: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    separator: Mapped[str] = mapped_column(String(16), default=",", server_default="','", nullable=False)
    reset_production_group: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    add_to_production_group: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer")
    elements: Mapped[list["ImportTemplateElement"]] = relationship(
        "ImportTemplateElement",
        back_populates="template",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="ImportTemplateElement.element_index",
    )


class ImportTemplateElement(Base):
    """A single field/column definition within an import template."""

    __tablename__ = "import_template_elements"

    template_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("import_templates.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    element_index: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0", nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    allow: Mapped[str | None] = mapped_column(String(255), nullable=True)
    disallow: Mapped[str | None] = mapped_column(String(255), nullable=True)
    allow_empty: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    allow_negative: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    allow_positive: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    allow_zero: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    date_format: Mapped[str] = mapped_column(
        String(32), default="MM/DD/YY", server_default="'MM/DD/YY'", nullable=False
    )
    decimal_separator: Mapped[str] = mapped_column(
        String(8), default=".", server_default="'.'", nullable=False
    )
    maximum_value: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    empty_is_zero: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    negative_parenthesis: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    sequence_separator: Mapped[str] = mapped_column(
        String(8), default=",", server_default="','", nullable=False
    )
    weekday_start: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    strip: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Relationships
    template: Mapped["ImportTemplate"] = relationship(
        "ImportTemplate", back_populates="elements"
    )
