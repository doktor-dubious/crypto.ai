"""Add request_data JSON column to task_records

Revision ID: d6ed0f734f7f
Revises: 1368fdc3e5f2
Create Date: 2026-03-28 10:16:12.992260

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd6ed0f734f7f'
down_revision: Union[str, None] = '1368fdc3e5f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'task_records',
        sa.Column('request_data', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('task_records', 'request_data')
