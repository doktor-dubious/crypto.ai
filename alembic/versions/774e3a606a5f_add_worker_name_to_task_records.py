"""add worker_name to task_records

Revision ID: 774e3a606a5f
Revises: 078
Create Date: 2026-03-22 09:07:42.169768

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '774e3a606a5f'
down_revision: Union[str, None] = '078'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('task_records', sa.Column('worker_name', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('task_records', 'worker_name')
