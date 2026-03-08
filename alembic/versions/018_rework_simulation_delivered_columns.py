"""Rework simulation delivered columns: drop g1-g4 int counts, add diff_*, rename _profit cols.

Revision ID: 018
Revises: 017
Create Date: 2026-03-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old integer copy-count columns
    for col in ("delivered_g1", "delivered_g2", "delivered_g3", "delivered_g4"):
        op.drop_column("simulations", col)

    # Add diff columns (int, nullable, can be negative)
    for col in ("diff_delivered", "diff_sold", "diff_return"):
        op.add_column("simulations", sa.Column(col, sa.Integer(), nullable=True))

    # Rename *_profit columns to delivered_g1-4 (float)
    for old, new in (
        ("delivered_g1_profit", "delivered_g1"),
        ("delivered_g2_profit", "delivered_g2"),
        ("delivered_g3_profit", "delivered_g3"),
        ("delivered_g4_profit", "delivered_g4"),
    ):
        op.alter_column("simulations", old, new_column_name=new)


def downgrade() -> None:
    # Rename delivered_g1-4 back to *_profit
    for new, old in (
        ("delivered_g1", "delivered_g1_profit"),
        ("delivered_g2", "delivered_g2_profit"),
        ("delivered_g3", "delivered_g3_profit"),
        ("delivered_g4", "delivered_g4_profit"),
    ):
        op.alter_column("simulations", new, new_column_name=old)

    # Drop diff columns
    for col in ("diff_delivered", "diff_sold", "diff_return"):
        op.drop_column("simulations", col)

    # Re-add integer copy-count columns
    for col in ("delivered_g1", "delivered_g2", "delivered_g3", "delivered_g4"):
        op.add_column("simulations", sa.Column(col, sa.Integer(), nullable=True))
