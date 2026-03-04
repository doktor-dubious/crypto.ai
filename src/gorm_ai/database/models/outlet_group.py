"""OutletGroup and OutletGroupMember models."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer import Customer
    from gorm_ai.database.models.draw_adjustment import DrawAdjustment
    from gorm_ai.database.models.outlet import Outlet


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
    draw_adjustments: Mapped[list["DrawAdjustment"]] = relationship(
        "DrawAdjustment",
        back_populates="group",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


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
