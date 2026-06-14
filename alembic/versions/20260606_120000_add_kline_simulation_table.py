"""Add kline_simulation table for persisted walk-forward simulation runs.

Revision ID: 20260606_120000
Revises: 20260602_175000
Create Date: 2026-06-06 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260606_120000"
down_revision = "20260602_175000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kline_simulation",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("coin_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("quote_asset", sa.String(10), nullable=False),
        sa.Column("interval", sa.String(10), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("models", sa.JSON(), nullable=False),
        sa.Column("task_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("starred", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(["coin_id"], ["coin.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_kline_simulation_active", "kline_simulation", ["active"], unique=False)
    op.create_index("ix_kline_simulation_coin_id", "kline_simulation", ["coin_id"], unique=False)
    op.create_index("ix_kline_simulation_task_id", "kline_simulation", ["task_id"], unique=False)
    op.create_index("ix_kline_simulation_status", "kline_simulation", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_kline_simulation_status", table_name="kline_simulation")
    op.drop_index("ix_kline_simulation_task_id", table_name="kline_simulation")
    op.drop_index("ix_kline_simulation_coin_id", table_name="kline_simulation")
    op.drop_index("ix_kline_simulation_active", table_name="kline_simulation")
    op.drop_table("kline_simulation")
