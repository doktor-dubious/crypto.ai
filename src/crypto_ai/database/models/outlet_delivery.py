"""OutletDelivery model for weekday-based delivery configuration."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, SmallInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.outlet import Outlet


class OutletDelivery(Base):
    """Weekday-based delivery configuration for outlets."""

    __tablename__ = "outlet_deliveries"

    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        index=True,
    )
    weekday: Mapped[int] = mapped_column(SmallInteger)  # 1-7, Monday=1, Sunday=7
    open: Mapped[bool] = mapped_column(Boolean, default=False)
    fixed: Mapped[float | None] = mapped_column(default=None)
    minimum: Mapped[float | None] = mapped_column(default=None)
    maximum: Mapped[float | None] = mapped_column(default=None)
    add: Mapped[float | None] = mapped_column(default=None)
    add_pct: Mapped[float | None] = mapped_column(default=None)

    # Relationships
    outlet: Mapped["Outlet"] = relationship(
        "Outlet",
        back_populates="deliveries",
    )
