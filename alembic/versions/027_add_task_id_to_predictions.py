"""Add task_id to predictions table.

Revision ID: 027
Revises: 026
Create Date: 2026-03-08 00:00:00.000000

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("predictions", sa.Column("task_id", sa.String(255), nullable=True))
    op.create_index("ix_predictions_task_id", "predictions", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_predictions_task_id", table_name="predictions")
    op.drop_column("predictions", "task_id")
