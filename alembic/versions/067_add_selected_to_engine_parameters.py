"""Add selected column to prediction_engine_parameter.

Revision ID: 067
Revises: 066
"""

import sqlalchemy as sa
from alembic import op

revision = "067"
down_revision = "066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prediction_engine_parameter",
        sa.Column(
            "selected",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("prediction_engine_parameter", "selected")
