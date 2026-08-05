"""Add paper_sweep table + paper_trade_run.sweep_id.

A sweep rotates many (strategy template × coin) combos through paper-trade
runs: up to max_concurrent at a time, each for dwell_days, drawing the next
untried combo from the cartesian product of template_ids × coin_ids. Runs
started by a sweep carry its id in sweep_id, which doubles as the "combo
already tried" marker.

Revision ID: 20260803_100000
Revises: 20260722_100000
Create Date: 2026-08-03
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260803_100000"
down_revision = "20260722_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "paper_sweep",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("template_ids", postgresql.JSON(), nullable=False),
        sa.Column("coin_ids", postgresql.JSON(), nullable=False),
        sa.Column("max_concurrent", sa.Integer(), server_default=sa.text("75"), nullable=False),
        sa.Column("dwell_days", sa.Float(), server_default=sa.text("7"), nullable=False),
        sa.Column("initial_capital", sa.Float(), server_default=sa.text("100"), nullable=False),
    )
    op.create_index("ix_paper_sweep_active", "paper_sweep", ["active"])
    op.add_column(
        "paper_trade_run",
        sa.Column("sweep_id", postgresql.UUID(as_uuid=False), nullable=True),
    )
    op.create_index("ix_paper_trade_run_sweep_id", "paper_trade_run", ["sweep_id"])
    op.create_foreign_key(
        "fk_paper_trade_run_sweep_id",
        "paper_trade_run",
        "paper_sweep",
        ["sweep_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_paper_trade_run_sweep_id", "paper_trade_run", type_="foreignkey")
    op.drop_index("ix_paper_trade_run_sweep_id", table_name="paper_trade_run")
    op.drop_column("paper_trade_run", "sweep_id")
    op.drop_index("ix_paper_sweep_active", table_name="paper_sweep")
    op.drop_table("paper_sweep")
