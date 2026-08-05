"""Saved parameter templates for trading strategies.

A template is a named bundle of a single strategy's signal parameters (the knobs
a user tweaks on the strategy's Analytics page), stored as a JSON blob so it maps
directly onto the dicts the frontend explorers already build. Scope (coin / pair /
timeframe / dates) is deliberately NOT stored — it's picked fresh at load/apply
time so one template is reusable across coins. Templates are global (no customer
or user scoping).
"""

from sqlalchemy import Boolean, String, Text, text
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class StrategyTemplate(Base):
    """A named set of signal parameters for one trading strategy."""

    __tablename__ = "strategy_template"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Strategy slug this template applies to: swings | range | momentum |
    # indicator | streak | sweep | takerflow. A template only loads on its strategy.
    strategy: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # The strategy's signal/execution knobs, verbatim from the explorer.
    params: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default=text("'{}'")
    )
    # Scope captured at save time — {coin_id, quote_asset, interval} — so Paper
    # Trade can restore the full setup (strategy + coin + pair + timeframe) from a
    # template. Nullable: older templates / analytics-only saves may have none.
    scope: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # An ABSTRACT strategy is params only — no coin / pair / timeframe of its own
    # (``scope`` is null); the scope is picked when a paper run is started, so one
    # abstract strategy can be pointed at any market. A concrete strategy is
    # pinned to the scope above and cannot diverge from it.
    is_abstract: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), index=True
    )
    # Short one-line description shown in the template modal (distinct from notes).
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # External AI trade confirmation: when on, each new paper-trade entry is sent
    # to the AI trade advisor and only executes if the verdict is GO. Read live
    # (not from the run snapshot) so it can be toggled while a run is going.
    ai_confirmation: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
