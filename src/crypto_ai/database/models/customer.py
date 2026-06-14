"""Customer model."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from crypto_ai.database.base import Base

if TYPE_CHECKING:
    from crypto_ai.database.models.customer_configuration import CustomerConfiguration
    from crypto_ai.database.models.financial_date import FinancialDate
    from crypto_ai.database.models.outlet import Outlet
    from crypto_ai.database.models.outlet_group import OutletGroup
    from crypto_ai.database.models.pad import Pad
    from crypto_ai.database.models.prediction_strategy import PredictionStrategy
    from crypto_ai.database.models.price_history import PriceHistory
    from crypto_ai.database.models.sales import Sales
    from crypto_ai.database.models.sales_filter import SalesFilter
    from crypto_ai.database.models.simulation_filter import SimulationFilter


class Customer(Base):
    """Customer model representing a business client."""

    __tablename__ = "customers"

    type: Mapped[int] = mapped_column(SmallInteger, default=0)
    name: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    outlets: Mapped[list["Outlet"]] = relationship(
        "Outlet",
        back_populates="customer",
        lazy="noload",
    )
    outlet_groups: Mapped[list["OutletGroup"]] = relationship(
        "OutletGroup",
        back_populates="customer",
        lazy="noload",
    )
    sales: Mapped[list["Sales"]] = relationship(
        "Sales",
        back_populates="customer",
        lazy="noload",
    )
    configuration: Mapped["CustomerConfiguration | None"] = relationship(
        "CustomerConfiguration",
        back_populates="customer",
        lazy="noload",
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
    simulation_filters: Mapped[list["SimulationFilter"]] = relationship(
        "SimulationFilter",
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
    price_history: Mapped[list["PriceHistory"]] = relationship(
        "PriceHistory",
        back_populates="customer",
        lazy="noload",
        cascade="all, delete-orphan",
    )
