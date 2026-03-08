"""Shorten delivered_* column names on simulations to d_* prefix.

Revision ID: 020
Revises: 019
Create Date: 2026-03-06 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RENAMES = [
    ("delivered_diff_delivered", "d_diff_delivered"),
    ("delivered_diff_return", "d_diff_return"),
    ("delivered_loss_sale", "d_lost_sale"),
    ("delivered_more_sale", "d_more_sale"),
    ("delivered_g1", "d_g1"),
    ("delivered_g2", "d_g2"),
    ("delivered_g3", "d_g3"),
    ("delivered_g4", "d_g4"),
]


def upgrade() -> None:
    for old, new in _RENAMES:
        op.alter_column("simulations", old, new_column_name=new)


def downgrade() -> None:
    for old, new in _RENAMES:
        op.alter_column("simulations", new, new_column_name=old)
