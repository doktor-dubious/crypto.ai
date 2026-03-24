"""Add finetune_sync_target to prediction_engine.

Revision ID: 088
Revises: 087
Create Date: 2026-03-24

"""

import sqlalchemy as sa
from alembic import op

revision: str = "088"
down_revision: str = "087"
branch_labels: tuple | None = None
depends_on: tuple | None = None


def upgrade() -> None:
    op.add_column("prediction_engine", sa.Column("finetune_sync_target", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("prediction_engine", "finetune_sync_target")
