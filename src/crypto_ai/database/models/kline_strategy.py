"""KlineStrategy: a reusable crypto-simulation configuration preset."""

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


from crypto_ai.database.base import Base


class KlineStrategy(Base):
    """A saved crypto-simulation strategy (engine + run config + parameters)."""

    __tablename__ = "kline_strategy"

    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Run mode shown in the New-Simulation form: "price" | "kline".
    simulation_strategy: Mapped[str] = mapped_column(String, nullable=False, server_default="price")
    # Null = base model (no finetuning); otherwise a finetuned checkpoint name.
    finetuned_model: Mapped[str | None] = mapped_column(String, nullable=True)
    # Forecast engine name (e.g. "timesfm", "chronos2").
    forecast_engine: Mapped[str | None] = mapped_column(String, nullable=True)
    forecast_vol: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    starred: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    parameters: Mapped[list["KlineStrategyParameter"]] = relationship(
        "KlineStrategyParameter",
        back_populates="strategy",
        cascade="all, delete-orphan",
    )


class KlineStrategyParameter(Base):
    """A single tunable parameter (name/value) attached to a KlineStrategy."""

    __tablename__ = "kline_strategy_parameter"

    strategy_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("kline_strategy.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    strategy: Mapped["KlineStrategy"] = relationship("KlineStrategy", back_populates="parameters")
