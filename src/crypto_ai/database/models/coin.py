"""Coin model for cryptocurrency tracking."""

from sqlalchemy import Boolean, Column, String, Text, text
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
    # Which Binance markets list this coin — drives the fee models a strategy may
    # use (spot-taker needs a spot market; futures maker/taker need a perpetual).
    # NULL = not yet checked. Populated by MarketAvailabilityService.
    has_spot = Column(Boolean, nullable=True)
    has_futures = Column(Boolean, nullable=True)
