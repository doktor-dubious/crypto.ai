"""Rework simulation prediction columns: rename totals, drop g1-4 counts, add diff/lost/more, rename profits.

Revision ID: 022
Revises: 021
Create Date: 2026-03-06 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TOTAL_RENAMES = [
    ("prediction_total_delivered", "p_total_delivered"),
    ("prediction_total_sold", "p_total_sold"),
    ("prediction_total_returned", "p_total_returned"),
]

_PROFIT_RENAMES = [
    ("prediction_g1_profit", "p_g1"),
    ("prediction_g2_profit", "p_g2"),
    ("prediction_g3_profit", "p_g3"),
    ("prediction_g4_profit", "p_g4"),
]

_DROP_COLS = ["prediction_g1", "prediction_g2", "prediction_g3", "prediction_g4"]

_ADD_COLS = ["p_diff_delivered", "p_diff_return", "p_lost_sale", "p_more_sale"]


def upgrade() -> None:
    for old, new in _TOTAL_RENAMES:
        op.alter_column("simulations", old, new_column_name=new)

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

    for old, new in _TOTAL_RENAMES:
        op.alter_column("simulations", new, new_column_name=old)
