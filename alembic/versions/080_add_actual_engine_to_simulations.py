"""Add actual_engine column to simulations table.

Revision ID: 080
Revises: 079
Create Date: 2026-03-22

"""

import sqlalchemy as sa
from alembic import op

revision: str = "080"
down_revision: str = "079"
branch_labels: tuple | None = None
depends_on: tuple | None = None


def upgrade() -> None:
    op.add_column("simulations", sa.Column("actual_engine", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("simulations", "actual_engine")
