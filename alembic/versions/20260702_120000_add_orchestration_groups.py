"""Add orchestration_groups table (crypto model orchestration).

Global (non-tenant) ensemble groups whose blend weights are calibrated by a
rolling-origin walk-forward backtest over a universe of kline series.

Revision ID: 20260702_120000
Revises: 20260702_100000
Create Date: 2026-07-02
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260702_120000"
down_revision = "20260702_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "orchestration_groups",
        sa.Column("id", sa.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("engine_slugs", postgresql.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("calibrated_slugs", postgresql.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("calibrated_basis", postgresql.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("engine_workers", postgresql.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("engine_params", postgresql.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("model_composition", postgresql.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("weights_by_key", postgresql.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("quote_asset", sa.String(length=10), server_default=sa.text("'USDT'"), nullable=False),
        sa.Column("interval", sa.String(length=10), server_default=sa.text("'1h'"), nullable=False),
        sa.Column("coin_ids", postgresql.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("top_n", sa.Integer(), server_default=sa.text("4"), nullable=False),
        sa.Column("calibration_metric", sa.String(length=32), server_default=sa.text("'mase'"), nullable=False),
        sa.Column("prediction_target", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'draft'"), nullable=False),
        sa.Column("last_calibrated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_calibration_score", sa.Float(), nullable=True),
        sa.Column("created_by", sa.UUID(as_uuid=False), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_orchestration_group_name"),
    )
    op.create_index("ix_orchestration_groups_active", "orchestration_groups", ["active"])


def downgrade() -> None:
    op.drop_index("ix_orchestration_groups_active", table_name="orchestration_groups")
    op.drop_table("orchestration_groups")
