"""Split optimize_covariate_types into per-type flags

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-07 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'optimization_runs',
        sa.Column('optimize_covariate_weekday', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.add_column(
        'optimization_runs',
        sa.Column('optimize_covariate_price', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.add_column(
        'optimization_runs',
        sa.Column('optimize_covariate_pad', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.drop_column('optimization_runs', 'optimize_covariate_types')


def downgrade() -> None:
    op.add_column(
        'optimization_runs',
        sa.Column('optimize_covariate_types', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.drop_column('optimization_runs', 'optimize_covariate_pad')
    op.drop_column('optimization_runs', 'optimize_covariate_price')
    op.drop_column('optimization_runs', 'optimize_covariate_weekday')
