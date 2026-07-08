"""Add coin/pair/timeframe fields to fine_tunes; make customer_id nullable.

Fine-tuning now targets crypto kline data (coin + quote asset + interval)
instead of customer sales data, so customer_id/outlet_group_id become
optional and coin_id/quote_asset/interval are added.

Revision ID: 20260616_150000
Revises: 20260616_140000
Create Date: 2026-06-16
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "20260616_150000"
down_revision = "20260616_140000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("fine_tunes", sa.Column("coin_id", UUID(as_uuid=False), nullable=True))
    op.add_column("fine_tunes", sa.Column("quote_asset", sa.String(length=10), nullable=True))
    op.add_column("fine_tunes", sa.Column("interval", sa.String(length=10), nullable=True))
    op.create_index("ix_fine_tunes_coin_id", "fine_tunes", ["coin_id"])
    op.create_foreign_key(
        "fk_fine_tunes_coin_id",
        "fine_tunes",
        "coin",
        ["coin_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.alter_column("fine_tunes", "customer_id", existing_type=UUID(as_uuid=False), nullable=True)


def downgrade() -> None:
    op.alter_column("fine_tunes", "customer_id", existing_type=UUID(as_uuid=False), nullable=False)
    op.drop_constraint("fk_fine_tunes_coin_id", "fine_tunes", type_="foreignkey")
    op.drop_index("ix_fine_tunes_coin_id", table_name="fine_tunes")
    op.drop_column("fine_tunes", "interval")
    op.drop_column("fine_tunes", "quote_asset")
    op.drop_column("fine_tunes", "coin_id")
