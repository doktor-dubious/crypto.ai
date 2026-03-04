"""Add cost_per_unit and profit_per_unit to configuration; change type in customer_configuration.

Revision ID: 004
Revises: 003
Create Date: 2026-03-04 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add cost_per_unit and profit_per_unit to configuration (system-wide fallbacks)
    op.add_column("configuration", sa.Column("cost_per_unit", sa.Float(), nullable=True))
    op.add_column("configuration", sa.Column("profit_per_unit", sa.Float(), nullable=True))

    # Change customer_configuration columns from numeric(10,2) to float
    op.alter_column("customer_configuration", "cost_per_unit", type_=sa.Float())
    op.alter_column("customer_configuration", "profit_per_unit", type_=sa.Float())


def downgrade() -> None:
    op.alter_column(
        "customer_configuration", "profit_per_unit", type_=sa.Numeric(10, 2)
    )
    op.alter_column(
        "customer_configuration", "cost_per_unit", type_=sa.Numeric(10, 2)
    )
    op.drop_column("configuration", "profit_per_unit")
    op.drop_column("configuration", "cost_per_unit")
