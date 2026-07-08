"""KlineStrategy: a reusable crypto-simulation configuration preset."""

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
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
    # Bars per forecast step. 1 = next-bar walk-forward; H>1 scores the model on
    # H-bar moves over non-overlapping windows (call the local trend, not the
    # next wiggle). Price strategy only.
    horizon: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    # How the swing-signal series (volume/range/trades z, taker, streak,
    # stretch, wicks) reach the model: "off" | "native" (model-side covariate
    # API — TimesFM/Chronos-2 only) | "external" (trailing Ridge on the pooled
    # walk-forward residual history — works with any engine).
    covariate_mode: Mapped[str] = mapped_column(String, nullable=False, server_default="off")
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
