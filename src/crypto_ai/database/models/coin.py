"""Coin model for cryptocurrency tracking."""

from sqlalchemy import Column, String, Text

from crypto_ai.database.base import Base


class Coin(Base):
    """Cryptocurrency coin information."""

    __tablename__ = "coin"

    symbol = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    type = Column(String, nullable=True)
