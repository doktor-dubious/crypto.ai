"""paper_trade_run: add name (per-run label).

The name the user gives one start→stop run — "Streak Reversion, Deep
(2026.08.05 #2)" — as opposed to ``template_name``, which is the snapshot of the
strategy's name at start time. Null on runs started before this column (and on
sweep-started runs, which have no user to name them); the UI falls back to
``template_name``.

Revision ID: 20260805_110000
Revises: 20260805_100000
Create Date: 2026-08-05
"""

import sqlalchemy as sa

from alembic import op

revision = "20260805_110000"
down_revision = "20260805_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "paper_trade_run", sa.Column("name", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("paper_trade_run", "name")
