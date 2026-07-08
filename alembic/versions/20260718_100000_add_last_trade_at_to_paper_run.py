"""paper_trade_run: add last_trade_at (drives the active-list order).

Records when a run last traded — the open position's entry, else the most recent
closed trade's exit — so the Paper Trade page can order active strategies
open-first, then by most-recently-traded, then by start time.

Revision ID: 20260718_100000
Revises: 20260717_100000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op

revision = "20260718_100000"
down_revision = "20260717_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "paper_trade_run",
        sa.Column("last_trade_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Backfill from existing trades so already-running runs sort correctly.
    op.execute(
        """
        UPDATE paper_trade_run r
        SET last_trade_at = sub.ts
        FROM (
            SELECT run_id, MAX(COALESCE(exit_time, entry_time)) AS ts
            FROM paper_trade
            GROUP BY run_id
        ) sub
        WHERE sub.run_id = r.id
        """
    )


def downgrade() -> None:
    op.drop_column("paper_trade_run", "last_trade_at")
