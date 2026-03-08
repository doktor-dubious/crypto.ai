"""Rename delivered_total_* columns to d_total_* on simulations.

Revision ID: 021
Revises: 020
Create Date: 2026-03-06 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RENAMES = [
    ("delivered_total_delivered", "d_total_delivered"),
    ("delivered_total_sold", "d_total_sold"),
    ("delivered_total_returned", "d_total_returned"),
]


def upgrade() -> None:
    for old, new in _RENAMES:
        op.alter_column("simulations", old, new_column_name=new)


def downgrade() -> None:
    for old, new in _RENAMES:
        op.alter_column("simulations", new, new_column_name=old)
