"""Elasticity event model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, func

from crypto_ai.database.base import Base


class ElasticityEvent(Base):
    """Event-based elasticity estimate for a price change."""

    __tablename__ = "elasticity_event"

    price_change_event_id = Column(SA_UUID(as_uuid=False), ForeignKey("price_change_event.id"))
    outlet_id = Column(SA_UUID(as_uuid=False), ForeignKey("outlet.id"))
    engine = Column(String, nullable=False)
    post_days = Column(Integer, nullable=False)
    task_id = Column(String, nullable=True)
    forecast_mean = Column(Float, nullable=True)
    actual_mean = Column(Float, nullable=True)
    n_post_days = Column(Integer, default=0)
    epsilon = Column(Float, nullable=True)
    confidence = Column(String, default="insufficient")
    reason = Column(String, nullable=True)
    computed_at = Column(DateTime(timezone=True), nullable=True)
