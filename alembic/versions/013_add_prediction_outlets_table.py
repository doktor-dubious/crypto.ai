"""Add prediction_outlets table.

Revision ID: 013
Revises: 012
Create Date: 2026-03-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prediction_outlets",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("prediction_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("outlet_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("delivered", sa.Float(), nullable=True),
        sa.Column("eo", sa.Float(), nullable=True),
        sa.Column("predicted", sa.Float(), nullable=True),
        sa.Column("lower_bound", sa.Float(), nullable=True),
        sa.Column("upper_bound", sa.Float(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("fixed", sa.Float(), nullable=True),
        sa.Column("minimum", sa.Float(), nullable=True),
        sa.Column("maximum", sa.Float(), nullable=True),
        sa.Column("add", sa.Float(), nullable=True),
        sa.Column("add_pct", sa.Float(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["prediction_id"], ["predictions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_prediction_outlets_prediction_id", "prediction_outlets", ["prediction_id"])
    op.create_index("ix_prediction_outlets_outlet_id", "prediction_outlets", ["outlet_id"])


def downgrade() -> None:
    op.drop_index("ix_prediction_outlets_outlet_id", table_name="prediction_outlets")
    op.drop_index("ix_prediction_outlets_prediction_id", table_name="prediction_outlets")
    op.drop_table("prediction_outlets")
