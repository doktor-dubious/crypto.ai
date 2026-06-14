"""LLM provider model."""

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class Llm(Base):
    """LLM provider (e.g. Anthropic, OpenAI)."""

    __tablename__ = "llm"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
