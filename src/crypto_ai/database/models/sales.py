"""Sales model."""

from datetime import date
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Date, ForeignKey, Integer, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer
    from crypto_ai.database.models.outlet import Outlet


class Sales(Base):
    """Sales data - configured as TimescaleDB hypertable.

    Uses composite primary key (id, date) as required by TimescaleDB.
    """

    __tablename__ = "sales"

    # Override base id — composite PK with date required by TimescaleDB
    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
        default=lambda: str(uuid4()),
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True, index=True)

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
