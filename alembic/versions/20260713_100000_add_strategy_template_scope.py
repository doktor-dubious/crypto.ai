"""strategy_template: add scope (coin/pair/timeframe) column.

Templates now capture the scope they were saved with — {coin_id, quote_asset,
interval} — so Paper Trade can restore the full setup (strategy + coin + pair +
timeframe) from a chosen template. Nullable for existing rows.

Revision ID: 20260713_100000
Revises: 20260712_100000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op

revision = "20260713_100000"
down_revision = "20260712_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("strategy_template", sa.Column("scope", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("strategy_template", "scope")
