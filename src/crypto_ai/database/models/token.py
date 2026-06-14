"""Token tracking models for API usage."""

from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer
    from crypto_ai.database.models.llm import Llm
    from crypto_ai.database.models.prediction_engine import PredictionEngine


class Token(Base):
    """Per-customer token budget and usage."""

    __tablename__ = "token"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    used: Mapped[int] = mapped_column(BigInteger, default=0)
    available: Mapped[int] = mapped_column(BigInteger, default=0)

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer")
    models: Mapped[list["TokenModel"]] = relationship(
        "TokenModel",
        back_populates="token",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    llms: Mapped[list["TokenLlm"]] = relationship(
        "TokenLlm",
        back_populates="token",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class TokenModel(Base):
    """Per-prediction-engine token usage within a customer budget."""

    __tablename__ = "token_model"

    token_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("token.id", ondelete="CASCADE"),
        index=True,
    )
    prediction_engine_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="CASCADE"),
        index=True,
    )
    used: Mapped[int] = mapped_column(BigInteger, default=0)
    available: Mapped[int] = mapped_column(BigInteger, default=0)

    # Relationships
    token: Mapped["Token"] = relationship(
        "Token", back_populates="models",
    )
    prediction_engine: Mapped["PredictionEngine"] = relationship(
        "PredictionEngine",
    )


class TokenLlm(Base):
    """Per-LLM-provider token usage within a customer budget."""

    __tablename__ = "token_llm"

    token_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("token.id", ondelete="CASCADE"),
        index=True,
    )
    llm_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("llm.id", ondelete="CASCADE"),
        index=True,
    )
    used: Mapped[int] = mapped_column(BigInteger, default=0)
    available: Mapped[int] = mapped_column(BigInteger, default=0)

    # Relationships
    token: Mapped["Token"] = relationship(
        "Token", back_populates="llms",
    )
    llm: Mapped["Llm"] = relationship("Llm")
