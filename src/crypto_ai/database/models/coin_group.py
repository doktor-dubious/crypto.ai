"""Coin groups — named collections of coins to tame a large coin list.

A group is global (no customer/user scoping). One reserved system group with
``slug="favorites"`` backs the heart/favorites UI on the coins page; ordinary
user-made groups have ``slug=None``. Membership is stored in
:class:`CoinGroupMember`.
"""

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base

# Reserved slug for the built-in favorites group.
FAVORITES_SLUG = "favorites"


class CoinGroup(Base):
    """A named collection of coins."""

    __tablename__ = "coin_group"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Stable identifier for reserved/system groups (e.g. "favorites"); NULL for
    # ordinary groups. Unique so there is exactly one group per reserved slug.
    slug: Mapped[str | None] = mapped_column(String(50), nullable=True, unique=True)
