"""live_trade_run: add name (per-run label).

The Strategies page names every run it starts, whichever venue it targets, so
the live table needs the same column the paper table got in 20260805_110000.

Revision ID: 20260805_120000
Revises: 20260805_110000
Create Date: 2026-08-05
"""

import sqlalchemy as sa

from alembic import op

revision = "20260805_120000"
down_revision = "20260805_110000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "live_trade_run", sa.Column("name", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("live_trade_run", "name")
