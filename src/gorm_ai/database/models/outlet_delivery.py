"""OutletDelivery model for weekday-based delivery configuration."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, SmallInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.outlet import Outlet


class OutletDelivery(Base):
    """Weekday-based delivery configuration for outlets."""

    __tablename__ = "outlet_deliveries"

    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        index=True,
    )
    weekday: Mapped[int] = mapped_column(SmallInteger)  # 0-6, Monday=0
    quantity: Mapped[int] = mapped_column(SmallInteger, default=0)

    # Relationships
    outlet: Mapped["Outlet"] = relationship(
        "Outlet",
        back_populates="deliveries",
    )
