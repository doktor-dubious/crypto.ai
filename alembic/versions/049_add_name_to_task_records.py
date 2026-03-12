"""Add name column to task_records.

Revision ID: 049
Revises: 048
Create Date: 2026-03-12

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "049"
down_revision: Union[str, None] = "048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_records",
        sa.Column("name", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("task_records", "name")
