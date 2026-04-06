"""ConfigurationCovariate model — per-customer covariate on/off switches."""

from sqlalchemy import ForeignKey, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base


class ConfigurationCovariate(Base):
    """Controls which covariate categories participate in predictions.

    Each row represents one covariate type (Weekday, Selling Price, or PAD)
    that can be toggled on/off.  Rows with customer_id=NULL are global
    defaults; customer-specific rows override the global defaults.

    Types:
      1 = Weekday one-hot dummies
      2 = Selling Price (financial covariates)
      3 = PAD event indicators
    """

    __tablename__ = "configuration_covariate"
    __table_args__ = (
        UniqueConstraint("customer_id", "type", name="uq_config_covariate_customer_type"),
    )

    customer_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    customer = relationship("Customer", lazy="selectin")
