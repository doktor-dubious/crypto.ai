"""Add simultaneous_tasks to configuration.

Revision ID: 058
Revises: 057
"""

import sqlalchemy as sa
from alembic import op

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "configuration",
        sa.Column("simultaneous_tasks", sa.Integer, nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("configuration", "simultaneous_tasks")
