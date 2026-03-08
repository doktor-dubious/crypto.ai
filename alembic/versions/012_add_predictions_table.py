"""Add predictions table.

Revision ID: 012
Revises: 011
Create Date: 2026-03-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "predictions",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("prediction_strategy_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("outlet_group_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("outlet_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=False)), nullable=True),
        sa.Column("prediction_from", sa.Date(), nullable=False),
        sa.Column("prediction_to", sa.Date(), nullable=False),
        sa.Column("delay", sa.SmallInteger(), nullable=True),
        sa.Column("engine", sa.Text(), nullable=True),
        sa.Column("engine_params", postgresql.JSON(), nullable=True),
        sa.Column("use_financials", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("use_pad", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("batch_size", sa.Integer(), nullable=False, server_default="32"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prediction_strategy_id"], ["prediction_strategies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["outlet_group_id"], ["outlet_group.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_predictions_customer_id", "predictions", ["customer_id"])
    op.create_index("ix_predictions_prediction_strategy_id", "predictions", ["prediction_strategy_id"])
    op.create_index("ix_predictions_outlet_group_id", "predictions", ["outlet_group_id"])


def downgrade() -> None:
    op.drop_index("ix_predictions_outlet_group_id", table_name="predictions")
    op.drop_index("ix_predictions_prediction_strategy_id", table_name="predictions")
    op.drop_index("ix_predictions_customer_id", table_name="predictions")
    op.drop_table("predictions")
