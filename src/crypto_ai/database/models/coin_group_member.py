"""Membership join between a coin group and a coin (many-to-many)."""

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crypto_ai.database.base import Base


class CoinGroupMember(Base):
    """One coin's membership in one coin group."""

    __tablename__ = "coin_group_member"
    __table_args__ = (
        UniqueConstraint("coin_group_id", "coin_id", name="uq_coin_group_member"),
    )

    coin_group_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("coin_group.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    coin_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("coin.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
