"""LLM submodel model."""

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base


class LlmSubmodel(Base):
    """LLM submodel (e.g. Opus, Sonnet, Haiku)."""

    __tablename__ = "llm_submodel"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("llm.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    llm: Mapped["Llm | None"] = relationship("Llm")
