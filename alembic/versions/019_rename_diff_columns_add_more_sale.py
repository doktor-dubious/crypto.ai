"""Rename diff_* columns and add delivered_more_sale on simulations.

Revision ID: 019
Revises: 018
Create Date: 2026-03-06 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("simulations", "diff_delivered", new_column_name="delivered_diff_delivered")
    op.alter_column("simulations", "diff_return", new_column_name="delivered_diff_return")
    op.alter_column("simulations", "diff_sold", new_column_name="delivered_loss_sale")
    op.add_column("simulations", sa.Column("delivered_more_sale", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("simulations", "delivered_more_sale")
    op.alter_column("simulations", "delivered_loss_sale", new_column_name="diff_sold")
    op.alter_column("simulations", "delivered_diff_return", new_column_name="diff_return")
    op.alter_column("simulations", "delivered_diff_delivered", new_column_name="diff_delivered")
