"""OutletInfo model for key-value additional information."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.outlet import Outlet


class OutletInfo(Base):
    """Key-value store for additional outlet information."""

    __tablename__ = "outlet_info"

    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        index=True,
    )
    key: Mapped[str] = mapped_column(String(100), index=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    outlet: Mapped["Outlet"] = relationship(
        "Outlet",
        back_populates="info",
    )
