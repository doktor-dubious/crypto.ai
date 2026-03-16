"""Add engine_params JSON column to simulations table.

Revision ID: 069
Revises: 068
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

from alembic import op

revision = "069"
down_revision = "068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "simulations",
        sa.Column("engine_params", JSON, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("simulations", "engine_params")
