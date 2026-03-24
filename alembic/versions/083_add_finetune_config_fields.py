"""Add finetuned_model_path and finetune_sync_every to configuration.

Revision ID: 083
Revises: 082
Create Date: 2026-03-23

"""

import sqlalchemy as sa
from alembic import op

revision: str = "083"
down_revision: str = "082"
branch_labels: tuple | None = None
depends_on: tuple | None = None


def upgrade() -> None:
    op.add_column(
        "configuration",
        sa.Column("finetuned_model_path", sa.String(500), nullable=False, server_default="models/timesfm_finetuned"),
    )
    op.add_column(
        "configuration",
        sa.Column("finetune_sync_every", sa.Integer(), nullable=False, server_default="5"),
    )


def downgrade() -> None:
    op.drop_column("configuration", "finetune_sync_every")
    op.drop_column("configuration", "finetuned_model_path")
