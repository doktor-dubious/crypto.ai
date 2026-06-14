"""OutletGroup and OutletGroupMember models."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer
    from crypto_ai.database.models.outlet import Outlet
    from crypto_ai.database.models.prediction_adjustment import PredictionAdjustment


class OutletGroup(Base):
    """Group of outlets belonging to a customer."""

    __tablename__ = "outlet_group"

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    customer: Mapped["Customer"] = relationship(
        "Customer",
        back_populates="outlet_groups",
    )
    members: Mapped[list["OutletGroupMember"]] = relationship(
        "OutletGroupMember",
        back_populates="group",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    prediction_adjustments: Mapped[list["PredictionAdjustment"]] = relationship(
        "PredictionAdjustment",
        back_populates="group",
        lazy="selectin",
        cascade="all, delete-orphan",
    )

    @property
    def outlet_count(self) -> int:
        """Count of active members in this group."""
        return sum(1 for m in self.members if m.active)


class OutletGroupMember(Base):
    """Association between outlets and groups."""

    __tablename__ = "outlet_group_members"

    group_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlet_group.id", ondelete="CASCADE"),
        index=True,
    )
    outlet_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlets.id", ondelete="CASCADE"),
        index=True,
    )

    # Relationships
    group: Mapped["OutletGroup"] = relationship(
        "OutletGroup",
        back_populates="members",
    )
    outlet: Mapped["Outlet"] = relationship("Outlet")
