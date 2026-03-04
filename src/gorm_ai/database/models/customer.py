"""Customer model."""

from typing import TYPE_CHECKING

from sqlalchemy import SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gorm_ai.database.base import Base

if TYPE_CHECKING:
    from gorm_ai.database.models.customer_configuration import CustomerConfiguration
    from gorm_ai.database.models.financial_date import FinancialDate
    from gorm_ai.database.models.prediction_strategy import PredictionStrategy
    from gorm_ai.database.models.sales_filter import SalesFilter
    from gorm_ai.database.models.outlet import Outlet
    from gorm_ai.database.models.outlet_group import OutletGroup
    from gorm_ai.database.models.pad import Pad
    from gorm_ai.database.models.sales import Sales


class Customer(Base):
    """Customer model representing a business client."""

    __tablename__ = "customers"

    type: Mapped[int] = mapped_column(SmallInteger, default=0)
    name: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    outlets: Mapped[list["Outlet"]] = relationship(
        "Outlet",
        back_populates="customer",
        lazy="selectin",
    )
    outlet_groups: Mapped[list["OutletGroup"]] = relationship(
        "OutletGroup",
        back_populates="customer",
        lazy="selectin",
    )
    sales: Mapped[list["Sales"]] = relationship(
        "Sales",
        back_populates="customer",
        lazy="noload",
    )
    configuration: Mapped["CustomerConfiguration | None"] = relationship(
        "CustomerConfiguration",
        back_populates="customer",
        lazy="selectin",
        cascade="all, delete-orphan",
        uselist=False,
    )
    pads: Mapped[list["Pad"]] = relationship(
        "Pad",
        back_populates="customer",
        lazy="noload",
        cascade="all, delete-orphan",
    )
    financial_dates: Mapped[list["FinancialDate"]] = relationship(
        "FinancialDate",
        back_populates="customer",
        lazy="noload",
        cascade="all, delete-orphan",
    )
    sales_filters: Mapped[list["SalesFilter"]] = relationship(
        "SalesFilter",
        back_populates="customer",
        lazy="noload",
        cascade="all, delete-orphan",
    )
    prediction_strategies: Mapped[list["PredictionStrategy"]] = relationship(
        "PredictionStrategy",
        back_populates="customer",
        lazy="noload",
        cascade="all, delete-orphan",
    )
