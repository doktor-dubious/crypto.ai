"""add finetune_allow_new_checkpoint to prediction_engine

Revision ID: e873d84747da
Revises: 349b391ce5e6
Create Date: 2026-03-31 14:44:21.439217

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e873d84747da'
down_revision: Union[str, None] = '349b391ce5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'prediction_engine',
        sa.Column(
            'finetune_allow_new_checkpoint',
            sa.Boolean(),
            server_default='false',
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column('prediction_engine', 'finetune_allow_new_checkpoint')
