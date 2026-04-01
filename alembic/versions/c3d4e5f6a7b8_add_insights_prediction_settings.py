"""add insights prediction settings to customer_configuration

Revision ID: c3d4e5f6a7b8
Revises: b1f2c3d4e5f6
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "c3d4e5f6a7b8"
down_revision = "b1f2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "customer_configuration",
        sa.Column("insights_prediction_engine_id", UUID(as_uuid=False), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("insights_prediction_strategy_id", UUID(as_uuid=False), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("insights_worker", sa.String(100), nullable=True),
    )
    op.create_foreign_key(
        "fk_custcfg_insights_engine",
        "customer_configuration",
        "prediction_engine",
        ["insights_prediction_engine_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_custcfg_insights_strategy",
        "customer_configuration",
        "prediction_strategies",
        ["insights_prediction_strategy_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("fk_custcfg_insights_strategy", "customer_configuration", type_="foreignkey")
    op.drop_constraint("fk_custcfg_insights_engine", "customer_configuration", type_="foreignkey")
    op.drop_column("customer_configuration", "insights_worker")
    op.drop_column("customer_configuration", "insights_prediction_strategy_id")
    op.drop_column("customer_configuration", "insights_prediction_engine_id")
