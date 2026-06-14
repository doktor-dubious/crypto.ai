"""User-Customer permission mapping."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer import Customer


class UserCustomer(Base):
    """Maps users to customers with granular permissions."""

    __tablename__ = "user_customer"
    __table_args__ = (
        UniqueConstraint("user_id", "customer_id", name="uq_user_customer_user_customer"),
    )

    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ba_users.id", ondelete="CASCADE", use_alter=True),
        nullable=False,
        index=True,
    )
    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Permissions
    allow_insight: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_prediction: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_customer_new: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_customer_view: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_sale_view: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_sale_analytics: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_outlet_new: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_outlet_view: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_outlet_analytics: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_outlet_group: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_outlet_bulk: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_pad_add: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_pad_view: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_filter_add: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_pad_predefined_view: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_financials_date_override: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_financials_price_history: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_financials_bulk: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_configuration_profile: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_configuration_settings: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_configuration_explore: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_ai_models: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    allow_system: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer", lazy="noload")
