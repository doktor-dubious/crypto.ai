"""Add name/description/strategy/config to kline_simulation.

Revision ID: 20260613_120000
Revises: 20260607_120000
Create Date: 2026-06-13
"""

import sqlalchemy as sa
from alembic import op

revision = "20260613_120000"
down_revision = "20260607_120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kline_simulation", sa.Column("name", sa.String(length=200), nullable=True))
    op.add_column("kline_simulation", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "kline_simulation",
        sa.Column(
            "strategy",
            sa.String(length=30),
            nullable=False,
            server_default="price",
        ),
    )
    op.add_column("kline_simulation", sa.Column("config", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("kline_simulation", "config")
    op.drop_column("kline_simulation", "strategy")
    op.drop_column("kline_simulation", "description")
    op.drop_column("kline_simulation", "name")
