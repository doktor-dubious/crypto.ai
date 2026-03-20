"""Add open_* day columns to configuration and customer_configuration.

Revision ID: 073
Revises: 072
"""

from alembic import op
import sqlalchemy as sa

revision = "073"
down_revision = "072"
branch_labels = None
depends_on = None

_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def upgrade() -> None:
    for day in _DAYS:
        col = f"open_{day}"
        op.add_column(
            "configuration",
            sa.Column(col, sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )
        op.add_column(
            "customer_configuration",
            sa.Column(col, sa.Boolean(), nullable=True),
        )


def downgrade() -> None:
    for day in _DAYS:
        col = f"open_{day}"
        op.drop_column("customer_configuration", col)
        op.drop_column("configuration", col)
