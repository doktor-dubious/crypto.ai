"""Update outlet_deliveries: replace quantity with fixed/minimum/maximum/add/add_pct, weekday 1-7.

Revision ID: 011
Revises: 010
Create Date: 2026-03-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("outlet_deliveries", "quantity")
    op.add_column("outlet_deliveries", sa.Column("fixed", sa.Float(), nullable=True))
    op.add_column("outlet_deliveries", sa.Column("minimum", sa.Float(), nullable=True))
    op.add_column("outlet_deliveries", sa.Column("maximum", sa.Float(), nullable=True))
    op.add_column("outlet_deliveries", sa.Column("add", sa.Float(), nullable=True))
    op.add_column("outlet_deliveries", sa.Column("add_pct", sa.Float(), nullable=True))
    # Migrate weekday convention from 0-6 (Monday=0) to 1-7 (Monday=1)
    op.execute("UPDATE outlet_deliveries SET weekday = weekday + 1")


def downgrade() -> None:
    op.execute("UPDATE outlet_deliveries SET weekday = weekday - 1")
    op.drop_column("outlet_deliveries", "add_pct")
    op.drop_column("outlet_deliveries", "add")
    op.drop_column("outlet_deliveries", "maximum")
    op.drop_column("outlet_deliveries", "minimum")
    op.drop_column("outlet_deliveries", "fixed")
    op.add_column("outlet_deliveries", sa.Column("quantity", sa.SmallInteger(), nullable=False, server_default="0"))
