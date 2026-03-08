"""Rework simulation eo columns: drop g1-4 int counts, add diff/lost/more, rename profits.

Revision ID: 023
Revises: 022
Create Date: 2026-03-06 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DROP_COLS = ["eo_g1", "eo_g2", "eo_g3", "eo_g4"]

_ADD_COLS = ["eo_diff_delivered", "eo_diff_return", "eo_lost_sale", "eo_more_sale"]

_PROFIT_RENAMES = [
    ("eo_g1_profit", "eo_g1"),
    ("eo_g2_profit", "eo_g2"),
    ("eo_g3_profit", "eo_g3"),
    ("eo_g4_profit", "eo_g4"),
]


def upgrade() -> None:
    for col in _DROP_COLS:
        op.drop_column("simulations", col)

    for col in _ADD_COLS:
        op.add_column("simulations", sa.Column(col, sa.Integer(), nullable=True))

    for old, new in _PROFIT_RENAMES:
        op.alter_column("simulations", old, new_column_name=new)


def downgrade() -> None:
    for old, new in _PROFIT_RENAMES:
        op.alter_column("simulations", new, new_column_name=old)

    for col in _ADD_COLS:
        op.drop_column("simulations", col)

    for col in _DROP_COLS:
        op.add_column("simulations", sa.Column(col, sa.Integer(), nullable=True))
