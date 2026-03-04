"""Add prediction_strategies table.

Revision ID: 009
Revises: 008
Create Date: 2026-03-04 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prediction_strategies",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("prediction_engine_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("increase_total_by_number", sa.Float(), nullable=True),
        sa.Column("increase_total_by_percentage", sa.Float(), nullable=True),
        sa.Column("increase_outlets_by_number", sa.Float(), nullable=True),
        sa.Column("increase_outlets_by_percentage", sa.Float(), nullable=True),
        sa.Column("fixed_total_draw", sa.Float(), nullable=True),
        sa.Column("total_return_percentage", sa.Float(), nullable=True),
        sa.Column("outlet_return_percentage", sa.Float(), nullable=True),
        sa.Column("ignore_fixed_draw", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("ignore_minimum_draw", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("ignore_maximum_draw", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prediction_engine_id"], ["prediction_engines.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_prediction_strategies_customer_id", "prediction_strategies", ["customer_id"])
    op.create_index("ix_prediction_strategies_prediction_engine_id", "prediction_strategies", ["prediction_engine_id"])


def downgrade() -> None:
    op.drop_index("ix_prediction_strategies_prediction_engine_id", table_name="prediction_strategies")
    op.drop_index("ix_prediction_strategies_customer_id", table_name="prediction_strategies")
    op.drop_table("prediction_strategies")
