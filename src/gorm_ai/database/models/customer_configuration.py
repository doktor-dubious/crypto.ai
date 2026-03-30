"""Customer-level configuration overrides."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.currency import Currency
    from gorm_ai.database.models.customer import Customer
    from gorm_ai.database.models.outlet_group import OutletGroup
    from gorm_ai.database.models.prediction_engine import PredictionEngine


class CustomerConfiguration(Base):
    """Customer-level configuration overrides."""

    __tablename__ = "customer_configuration"
    __table_args__ = (
        UniqueConstraint("customer_id", name="uq_customer_configuration_customer_id"),
    )

    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    peak_period: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    minimum_delivery: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    profit_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    eo_to_delivery_rounding: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1=round, 2=ceil, 3=floor; None = inherit from global config
    weekday_correction_mon: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_correction_tue: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_correction_wed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_correction_thu: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_correction_fri: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_correction_sat: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_correction_sun: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_only_mon: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_only_tue: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_only_wed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_only_thu: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_only_fri: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_only_sat: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_only_sun: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_profile_correction: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    weekday_profile_correction_strength: Mapped[float | None] = mapped_column(Float, nullable=True)
    weekday_profile_correction_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 1=additive, 2=multiplicative; None = inherit
    weekday_profile_correction_method: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
    )
    variation_adjustment: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True,
    )
    variation_history_days: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
    )
    eo_methodology: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
    )  # 1=interpolate, 2=snap; None = inherit
    eo_extrapolation: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
    )  # 1=extrapolate to ~E99, 2=conservative ~E95, 3=cap at E90; None = inherit
    fallback_engine: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    open_monday: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    open_tuesday: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    open_wednesday: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    open_thursday: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    open_friday: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    open_saturday: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    open_sunday: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    prediction_engine_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("prediction_engine.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    group_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlet_group.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    production_group_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("outlet_group.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    currency_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("currency.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Relationships
    customer: Mapped["Customer"] = relationship(
        "Customer",
        back_populates="configuration",
    )
    prediction_engine: Mapped["PredictionEngine | None"] = relationship("PredictionEngine")
    group: Mapped["OutletGroup | None"] = relationship("OutletGroup", foreign_keys=[group_id])
    production_group: Mapped["OutletGroup | None"] = relationship("OutletGroup", foreign_keys=[production_group_id])
    currency: Mapped["Currency | None"] = relationship("Currency", foreign_keys=[currency_id], lazy="selectin")

    @property
    def currency_symbol(self) -> str | None:
        return self.currency.symbol if self.currency else None
