"""Price change event model."""

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import Column, Date, Float, ForeignKey, SmallInteger

from crypto_ai.database.base import Base


class PriceChangeEvent(Base):
    """Detected price change event for elasticity analysis."""

    __tablename__ = "price_change_event"

    customer_id = Column(
        SA_UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    outlet_id = Column(
        SA_UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    weekday = Column(SmallInteger, nullable=False)
    change_date = Column(Date, nullable=False)
    price_before = Column(Float, nullable=False)
    price_after = Column(Float, nullable=False)
