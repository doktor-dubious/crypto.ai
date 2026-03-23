"""Add warnings column to simulations table.

Revision ID: 081
Revises: 080
Create Date: 2026-03-22

"""

import sqlalchemy as sa
from alembic import op

revision: str = "081"
down_revision: tuple = ("080", "774e3a606a5f")
branch_labels: tuple | None = None
depends_on: tuple | None = None


def upgrade() -> None:
    op.add_column("simulations", sa.Column("warnings", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("simulations", "warnings")
