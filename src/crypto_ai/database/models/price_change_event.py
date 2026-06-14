"""Price change event model."""

from datetime import date
from sqlalchemy import UUID as SA_UUID
from sqlalchemy import Column, Date, ForeignKey, SmallInteger

from crypto_ai.database.base import Base


class PriceChangeEvent(Base):
    """Detected price change event for elasticity analysis."""

    __tablename__ = "price_change_event"

    outlet_id = Column(SA_UUID(as_uuid=False), ForeignKey("outlet.id"), nullable=False)
    weekday = Column(SmallInteger, nullable=False)
    change_date = Column(Date, nullable=False)
    price_before = Column(SA_UUID(as_uuid=False), nullable=True)
    price_after = Column(SA_UUID(as_uuid=False), nullable=True)
