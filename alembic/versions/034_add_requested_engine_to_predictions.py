"""Add requested_engine column to predictions table.

Revision ID: 034
Revises: 033
Create Date: 2026-03-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "034"
down_revision: Union[str, None] = "033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("predictions", sa.Column("requested_engine", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("predictions", "requested_engine")
