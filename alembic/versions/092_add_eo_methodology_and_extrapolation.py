"""Add eo_methodology and eo_extrapolation to configuration tables.

Revision ID: 092
Revises: 091
Create Date: 2026-03-26

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "092"
down_revision: Union[str, None] = "091"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    # System configuration (non-nullable with defaults)
    op.add_column(
        "configuration",
        sa.Column("eo_methodology", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "configuration",
        sa.Column("eo_extrapolation", sa.Integer(), nullable=False, server_default="1"),
    )

    # Customer configuration (nullable, inherits from global when NULL)
    op.add_column(
        "customer_configuration",
        sa.Column("eo_methodology", sa.Integer(), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("eo_extrapolation", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "eo_extrapolation")
    op.drop_column("customer_configuration", "eo_methodology")
    op.drop_column("configuration", "eo_extrapolation")
    op.drop_column("configuration", "eo_methodology")
