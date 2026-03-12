"""Add actual_total_delivered/sale/returned to simulations.

Revision ID: 050
Revises: 049
Create Date: 2026-03-12

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "050"
down_revision: Union[str, None] = "049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("simulations", sa.Column("actual_total_delivered", sa.Float, nullable=True))
    op.add_column("simulations", sa.Column("actual_total_sale", sa.Float, nullable=True))
    op.add_column("simulations", sa.Column("actual_total_returned", sa.Float, nullable=True))


def downgrade() -> None:
    op.drop_column("simulations", "actual_total_returned")
    op.drop_column("simulations", "actual_total_sale")
    op.drop_column("simulations", "actual_total_delivered")
