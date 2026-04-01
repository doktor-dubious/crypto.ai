"""Chat session and message models for natural language interface."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer


class ChatSession(Base):
    """A conversation thread between a user and the AI assistant."""

    __tablename__ = "chat_session"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(Text, default="")
    starred: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"),
    )

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer")
    messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage",
        back_populates="session",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )


class ChatMessage(Base):
    """A single message in a chat session."""

    __tablename__ = "chat_message"

    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("chat_session.id", ondelete="CASCADE"),
        index=True,
    )
    role: Mapped[int] = mapped_column(
        SmallInteger,
        comment="1=user, 2=assistant, 3=tool_call, 4=tool_result",
    )
    content: Mapped[str] = mapped_column(Text, default="")
    # Structured data: chart config, outlet list, tool call info, etc.
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Token usage for this specific message (assistant messages only)
    input_tokens: Mapped[int | None] = mapped_column(nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(nullable=True)

    # Relationships
    session: Mapped["ChatSession"] = relationship(
        "ChatSession", back_populates="messages",
    )
