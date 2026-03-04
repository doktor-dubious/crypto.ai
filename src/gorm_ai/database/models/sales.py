"""Sales model."""

from datetime import UTC, date, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, PrimaryKeyConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(UTC)


if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer
    from gorm_ai.database.models.outlet import Outlet


class SalesBase(DeclarativeBase):
    """Separate base for Sales to support composite primary key."""

    pass


class Sales(SalesBase):
    """Sales data - configured as TimescaleDB hypertable.

    Uses composite primary key (id, date) as required by TimescaleDB.
    """

    __tablename__ = "sales"
    __table_args__ = (PrimaryKeyConstraint("id", "date"),)

    # Composite primary key columns
    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        default=lambda: str(uuid4()),
    )
    date: Mapped[date] = mapped_column(Date, index=True)

    # Common columns (duplicated from Base since we use different base)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    # Foreign keys
    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        index=True,
    )

    # Core prediction field
    sold: Mapped[int] = mapped_column(Integer, default=0)

    # Additional analytics fields (nullable for flexibility)
    delivered: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scan_sold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    net_sold: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Relationships
    customer: Mapped["Customer"] = relationship(
        "Customer",
        back_populates="sales",
    )
    outlet: Mapped["Outlet"] = relationship(
        "Outlet",
        back_populates="sales",
    )
