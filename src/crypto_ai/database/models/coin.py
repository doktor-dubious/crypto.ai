"""Coin model for cryptocurrency tracking."""

from sqlalchemy import Column, String, Text, text
from sqlalchemy.types import JSON

from crypto_ai.database.base import Base


class Coin(Base):
    """Cryptocurrency coin information."""

    __tablename__ = "coin"

    symbol = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    type = Column(String, nullable=True)
    # Classification tags fetched from CoinGecko (e.g. "Layer 1", "DeFi", "Meme").
    # A coin usually spans several categories, so this is a list, not a single type.
    categories = Column(JSON, nullable=False, default=list, server_default=text("'[]'"))
