"""Add kline_simulation_prediction table (full per-timestamp forecasts).

Revision ID: 20260606_140000
Revises: 20260606_120000
Create Date: 2026-06-06 14:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260606_140000"
down_revision = "20260606_120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kline_simulation_prediction",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("simulation_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("model_name", sa.String(64), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actual", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("predicted", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("error", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("pct_error", sa.Numeric(precision=12, scale=4), nullable=False),
        sa.ForeignKeyConstraint(["simulation_id"], ["kline_simulation.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_kline_simulation_prediction_active", "kline_simulation_prediction", ["active"], unique=False)
    op.create_index("ix_kline_simulation_prediction_simulation_id", "kline_simulation_prediction", ["simulation_id"], unique=False)
    op.create_index("ix_kline_simulation_prediction_model_name", "kline_simulation_prediction", ["model_name"], unique=False)
    op.create_index("idx_sim_pred_sim_model_time", "kline_simulation_prediction", ["simulation_id", "model_name", "timestamp"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_sim_pred_sim_model_time", table_name="kline_simulation_prediction")
    op.drop_index("ix_kline_simulation_prediction_model_name", table_name="kline_simulation_prediction")
    op.drop_index("ix_kline_simulation_prediction_simulation_id", table_name="kline_simulation_prediction")
    op.drop_index("ix_kline_simulation_prediction_active", table_name="kline_simulation_prediction")
    op.drop_table("kline_simulation_prediction")
