"""Add klines table for Binance kline (OHLCV) data.

Revision ID: 20260602_163700
Revises: e195903dc18d
Create Date: 2026-06-02 16:37:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260602_163700"
down_revision = "e195903dc18d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "klines",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.literal(True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("coin_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("interval", sa.String(10), nullable=False),
        sa.Column("open_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("close_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("high", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("low", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("close", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("volume", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("quote_asset_volume", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("number_of_trades", sa.BigInteger(), nullable=False),
        sa.Column("taker_buy_base_asset_volume", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("taker_buy_quote_asset_volume", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.ForeignKeyConstraint(["coin_id"], ["coin.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_klines_active", "klines", ["active"], unique=False)
    op.create_index("ix_klines_coin_id", "klines", ["coin_id"], unique=False)
    op.create_index("ix_klines_interval", "klines", ["interval"], unique=False)
    op.create_index("ix_klines_open_time", "klines", ["open_time"], unique=False)
    op.create_index("ix_klines_close_time", "klines", ["close_time"], unique=False)
    op.create_index(
        "idx_kline_coin_interval_time",
        "klines",
        ["coin_id", "interval", "open_time"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_kline_coin_interval_time", table_name="klines")
    op.drop_index("ix_klines_close_time", table_name="klines")
    op.drop_index("ix_klines_open_time", table_name="klines")
    op.drop_index("ix_klines_interval", table_name="klines")
    op.drop_index("ix_klines_coin_id", table_name="klines")
    op.drop_index("ix_klines_active", table_name="klines")
    op.drop_table("klines")
