"""Add progress columns to task_records.

Revision ID: 026
Revises: 025
Create Date: 2026-03-07 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("task_records", sa.Column("progress", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("task_records", sa.Column("progress_message", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("task_records", "progress_message")
    op.drop_column("task_records", "progress")
