"""Add peak_memory_mb and cpu_time_s to task_records.

Revision ID: 056
Revises: 055
Create Date: 2026-03-13

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "056"
down_revision: Union[str, None] = "055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("task_records", sa.Column("peak_memory_mb", sa.Float, nullable=True))
    op.add_column("task_records", sa.Column("cpu_time_s", sa.Float, nullable=True))


def downgrade() -> None:
    op.drop_column("task_records", "cpu_time_s")
    op.drop_column("task_records", "peak_memory_mb")
