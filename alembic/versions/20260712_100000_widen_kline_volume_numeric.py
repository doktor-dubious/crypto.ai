"""klines: widen volume columns to unconstrained numeric.

Low-price/high-supply coins (e.g. WINUSDT) can have a monthly base-asset volume
above 10^12, which overflows numeric(20,8) ("numeric field overflow"). Widen the
four volume columns to unconstrained numeric — a metadata-only change in Postgres
(no table rewrite; verified ~0.03s on the 11 GB table). Prices stay (20,8).

Revision ID: 20260712_100000
Revises: 20260711_100000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op

revision = "20260712_100000"
down_revision = "20260711_100000"
branch_labels = None
depends_on = None

_COLUMNS = [
    "volume",
    "quote_asset_volume",
    "taker_buy_base_asset_volume",
    "taker_buy_quote_asset_volume",
]


def upgrade() -> None:
    for col in _COLUMNS:
        op.alter_column("klines", col, type_=sa.Numeric(), existing_nullable=False)


def downgrade() -> None:
    # Narrowing may fail/rewrite if data now exceeds numeric(20,8); rarely used.
    for col in _COLUMNS:
        op.alter_column(
            "klines", col, type_=sa.Numeric(precision=20, scale=8), existing_nullable=False
        )
