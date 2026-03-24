"""Add data_start_date and data_end_date to finetune_progress.

Revision ID: 082
Revises: 081
Create Date: 2026-03-23

"""

import sqlalchemy as sa
from alembic import op

revision: str = "082"
down_revision: str = "081"
branch_labels: tuple | None = None
depends_on: tuple | None = None


def upgrade() -> None:
    op.add_column("finetune_progress", sa.Column("data_start_date", sa.Date(), nullable=True))
    op.add_column("finetune_progress", sa.Column("data_end_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("finetune_progress", "data_end_date")
    op.drop_column("finetune_progress", "data_start_date")
