"""Add finetune_sane_epochs and finetune_max_mae to prediction_engine.

Revision ID: 094
Revises: 093
Create Date: 2026-03-29

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "094"
down_revision: Union[str, None] = "093"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "prediction_engine",
        sa.Column("finetune_sane_epochs", sa.Integer(), nullable=True),
    )
    op.add_column(
        "prediction_engine",
        sa.Column("finetune_max_mae", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("prediction_engine", "finetune_max_mae")
    op.drop_column("prediction_engine", "finetune_sane_epochs")
