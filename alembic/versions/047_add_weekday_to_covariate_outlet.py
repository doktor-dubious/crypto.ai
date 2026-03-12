"""Add weekday column to covariate_outlet.

Revision ID: 047
Revises: 046
Create Date: 2026-03-11

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "047"
down_revision: Union[str, None] = "046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "covariate_outlet",
        sa.Column("weekday", sa.SmallInteger(), nullable=True),
    )
    op.create_index("ix_covariate_outlet_weekday", "covariate_outlet", ["weekday"])


def downgrade() -> None:
    op.drop_index("ix_covariate_outlet_weekday", table_name="covariate_outlet")
    op.drop_column("covariate_outlet", "weekday")
