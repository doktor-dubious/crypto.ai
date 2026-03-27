"""add diagnostics to optimization_runs

Revision ID: 1368fdc3e5f2
Revises: 3000508351e7
Create Date: 2026-03-27 16:39:05.200469

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '1368fdc3e5f2'
down_revision: Union[str, None] = '3000508351e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('optimization_runs', sa.Column('diagnostics', postgresql.JSON(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('optimization_runs', 'diagnostics')
