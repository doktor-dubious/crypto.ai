"""Add quote_asset column to klines table

Revision ID: 20260602_175000
Revises: 20260602_174500
Create Date: 2026-06-02 17:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260602_175000"
down_revision: Union[str, None] = "20260602_174500"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add quote_asset column with default USDT
    op.add_column(
        "klines",
        sa.Column(
            "quote_asset",
            sa.String(10),
            nullable=False,
            server_default="USDT",
            index=True,
        ),
    )

    # Update composite index
    op.drop_index("idx_kline_coin_interval_time", table_name="klines")
    op.create_index(
        "idx_kline_coin_quote_interval_time",
        "klines",
        ["coin_id", "quote_asset", "interval", "open_time"],
    )


def downgrade() -> None:
    op.drop_index("idx_kline_coin_quote_interval_time", table_name="klines")
    op.create_index(
        "idx_kline_coin_interval_time",
        "klines",
        ["coin_id", "interval", "open_time"],
    )
    op.drop_column("klines", "quote_asset")
