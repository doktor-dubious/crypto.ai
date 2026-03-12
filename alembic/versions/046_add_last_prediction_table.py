"""Add last_prediction table.

Revision ID: 046
Revises: 045
Create Date: 2026-03-11

"""

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "046"
down_revision: Union[str, None] = "045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "last_prediction",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("outlet_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("prediction_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("predicted", sa.Float(), nullable=True),
        sa.Column("economic_optimal", sa.Float(), nullable=True),
        sa.Column("delivered", sa.Float(), nullable=True),
        sa.Column("lower_bound", sa.Float(), nullable=True),
        sa.Column("upper_bound", sa.Float(), nullable=True),
        sa.Column("fixed", sa.Float(), nullable=True),
        sa.Column("minimum", sa.Float(), nullable=True),
        sa.Column("maximum", sa.Float(), nullable=True),
        sa.Column("add", sa.Float(), nullable=True),
        sa.Column("add_pct", sa.Float(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prediction_id"], ["predictions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outlet_id", "weekday", name="uq_last_prediction_outlet_weekday"),
    )
    op.create_index("ix_last_prediction_outlet_id", "last_prediction", ["outlet_id"])


def downgrade() -> None:
    op.drop_table("last_prediction")
