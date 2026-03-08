"""Add eo_to_delivery_rounding to configuration and customer_configuration.

Revision ID: 016
Revises: 015
Create Date: 2026-03-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuration",
        sa.Column("eo_to_delivery_rounding", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("eo_to_delivery_rounding", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "eo_to_delivery_rounding")
    op.drop_column("configuration", "eo_to_delivery_rounding")
