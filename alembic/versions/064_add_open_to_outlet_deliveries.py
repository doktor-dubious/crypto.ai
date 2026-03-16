"""Add open column to outlet_deliveries table.

Revision ID: 064
Revises: 063
"""

import sqlalchemy as sa
from alembic import op

revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "outlet_deliveries",
        sa.Column("open", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("outlet_deliveries", "open")
