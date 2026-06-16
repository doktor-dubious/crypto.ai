"""Add kline_strategy + kline_strategy_parameter tables.

Revision ID: 20260616_120000
Revises: 20260614_120000
Create Date: 2026-06-16
"""

import sqlalchemy as sa
from alembic import op

revision = "20260616_120000"
down_revision = "20260614_120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kline_strategy",
        sa.Column(
            "id",
            sa.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("simulation_strategy", sa.String(), server_default="price", nullable=False),
        sa.Column("finetuned_model", sa.String(), nullable=True),
        sa.Column("forecast_engine", sa.String(), nullable=True),
        sa.Column("forecast_vol", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("starred", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_kline_strategy_active", "kline_strategy", ["active"])
    op.create_index("ix_kline_strategy_name", "kline_strategy", ["name"])

    op.create_table(
        "kline_strategy_parameter",
        sa.Column(
            "id",
            sa.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("strategy_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("selected", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.ForeignKeyConstraint(["strategy_id"], ["kline_strategy.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_kline_strategy_parameter_active", "kline_strategy_parameter", ["active"])
    op.create_index(
        "ix_kline_strategy_parameter_strategy_id", "kline_strategy_parameter", ["strategy_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_kline_strategy_parameter_strategy_id", table_name="kline_strategy_parameter")
    op.drop_index("ix_kline_strategy_parameter_active", table_name="kline_strategy_parameter")
    op.drop_table("kline_strategy_parameter")
    op.drop_index("ix_kline_strategy_name", table_name="kline_strategy")
    op.drop_index("ix_kline_strategy_active", table_name="kline_strategy")
    op.drop_table("kline_strategy")
