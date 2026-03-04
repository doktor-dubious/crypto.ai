"""Outlet model."""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer
    from gorm_ai.database.models.outlet_delivery import OutletDelivery
    from gorm_ai.database.models.outlet_financials import OutletFinancials
    from gorm_ai.database.models.outlet_info import OutletInfo
    from gorm_ai.database.models.sales import Sales


class Outlet(Base):
    """Outlet model representing a physical or virtual sales location."""

    __tablename__ = "outlets"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    ext_id: Mapped[str] = mapped_column(String(50), index=True)
    ext_id_2: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Address fields
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    zip: Mapped[str | None] = mapped_column(String(20), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Date range
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Flags
    scan: Mapped[bool] = mapped_column(Boolean, default=False)
    season: Mapped[bool] = mapped_column(Boolean, default=False)
    sublets: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relationships
    customer: Mapped["Customer"] = relationship(
        "Customer",
        back_populates="outlets",
    )
    info: Mapped[list["OutletInfo"]] = relationship(
        "OutletInfo",
        back_populates="outlet",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    deliveries: Mapped[list["OutletDelivery"]] = relationship(
        "OutletDelivery",
        back_populates="outlet",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    financials: Mapped[list["OutletFinancials"]] = relationship(
        "OutletFinancials",
        back_populates="outlet",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    sales: Mapped[list["Sales"]] = relationship(
        "Sales",
        back_populates="outlet",
        lazy="noload",
    )
