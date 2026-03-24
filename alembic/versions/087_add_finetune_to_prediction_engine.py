"""Add finetuned_model_path and finetune_sync_every to prediction_engine.

Revision ID: 087
Revises: 086
Create Date: 2026-03-24

"""

import sqlalchemy as sa
from alembic import op

revision: str = "087"
down_revision: str = "086"
branch_labels: tuple | None = None
depends_on: tuple | None = None


def upgrade() -> None:
    op.add_column("prediction_engine", sa.Column("finetuned_model_path", sa.String(500), nullable=True))
    op.add_column("prediction_engine", sa.Column("finetune_sync_every", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("prediction_engine", "finetune_sync_every")
    op.drop_column("prediction_engine", "finetuned_model_path")
