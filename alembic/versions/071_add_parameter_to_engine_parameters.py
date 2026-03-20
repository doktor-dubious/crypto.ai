"""Add parameter column to prediction_engine_parameter.

Revision ID: 071
Revises: 070
"""

import sqlalchemy as sa
from alembic import op

revision = "071"
down_revision = "070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prediction_engine_parameter",
        sa.Column("parameter", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("prediction_engine_parameter", "parameter")
