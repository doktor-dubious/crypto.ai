"""coin.categories: JSON list of CoinGecko category tags.

A coin usually spans several categories (BTC = Layer 1 + Store of Value), so a
JSON array is stored rather than overloading the single free-text `type` column.

Revision ID: 20260709_100000
Revises: 20260708_100000
Create Date: 2026-07-06
"""

import sqlalchemy as sa
from alembic import op

revision = "20260709_100000"
down_revision = "20260708_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "coin",
        sa.Column(
            "categories",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("coin", "categories")
