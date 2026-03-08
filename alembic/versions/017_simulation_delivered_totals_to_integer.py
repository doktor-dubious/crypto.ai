"""Change delivered_total_* columns in simulations to integer.

Revision ID: 017
Revises: 016
Create Date: 2026-03-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for col in ("delivered_total_delivered", "delivered_total_sold", "delivered_total_returned"):
        op.alter_column(
            "simulations",
            col,
            type_=sa.Integer(),
            existing_type=sa.Float(),
            existing_nullable=True,
            postgresql_using=f"{col}::integer",
        )


def downgrade() -> None:
    for col in ("delivered_total_delivered", "delivered_total_sold", "delivered_total_returned"):
        op.alter_column(
            "simulations",
            col,
            type_=sa.Float(),
            existing_type=sa.Integer(),
            existing_nullable=True,
        )
