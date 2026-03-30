"""Add fallback_engine to configuration tables.

Revision ID: 093
Revises: 1368fdc3e5f2
Create Date: 2026-03-29

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "093"
down_revision: Union[str, None] = "74bf96494e87"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    # System configuration (non-nullable with default False)
    op.add_column(
        "configuration",
        sa.Column("fallback_engine", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Customer configuration (nullable, inherits from global when NULL)
    op.add_column(
        "customer_configuration",
        sa.Column("fallback_engine", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "fallback_engine")
    op.drop_column("configuration", "fallback_engine")
