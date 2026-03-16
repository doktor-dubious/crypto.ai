"""Add description column to prediction_engine_parameter.

Revision ID: 068
Revises: 067
"""

import sqlalchemy as sa
from alembic import op

revision = "068"
down_revision = "067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prediction_engine_parameter",
        sa.Column("description", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("prediction_engine_parameter", "description")
