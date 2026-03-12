"""Add actual_sale column to prediction_outlets.

Revision ID: 048
Revises: 047
Create Date: 2026-03-11

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "048"
down_revision: Union[str, None] = "047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prediction_outlets",
        sa.Column("actual_sale", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("prediction_outlets", "actual_sale")
