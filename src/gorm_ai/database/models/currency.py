"""Currency reference table (ISO 4217)."""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from gorm_ai.database.base import Base


class Currency(Base):
    """ISO 4217 currency reference."""

    __tablename__ = "currency"

    iso_4217: Mapped[str] = mapped_column(String(3), nullable=False, unique=True, index=True)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
