"""Add default_prediction_engine to configuration tables.

Revision ID: 003
Revises: 002
Create Date: 2026-03-03 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuration",
        sa.Column("default_prediction_engine", sa.String(50), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("default_prediction_engine", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "default_prediction_engine")
    op.drop_column("configuration", "default_prediction_engine")
