"""OutletFinancials model for weekday-based cost/profit configuration."""

from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, SmallInteger, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.outlet import Outlet


class OutletFinancials(Base):
    """Weekday-based cost and profit configuration for outlets."""

    __tablename__ = "outlet_financials"
    __table_args__ = (
        UniqueConstraint("outlet_id", "weekday", name="uq_outlet_financials_outlet_weekday"),
    )

    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        index=True,
    )
    weekday: Mapped[int] = mapped_column(SmallInteger)  # 1=Monday, 7=Sunday
    cost_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    profit_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    outlet: Mapped["Outlet"] = relationship(
        "Outlet",
        back_populates="financials",
    )
