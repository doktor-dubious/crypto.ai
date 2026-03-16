"""Add sort_order column to prediction_engine_parameter.

Revision ID: 070
Revises: 069
"""

import sqlalchemy as sa
from alembic import op

revision = "070"
down_revision = "069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prediction_engine_parameter",
        sa.Column(
            "sort_order",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("prediction_engine_parameter", "sort_order")
