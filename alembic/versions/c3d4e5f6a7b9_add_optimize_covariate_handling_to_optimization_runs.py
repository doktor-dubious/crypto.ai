"""Add optimize_covariate_handling to optimization_runs

Revision ID: c3d4e5f6a7b9
Revises: b2c3d4e5f6a7
Create Date: 2026-04-02 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b9'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'optimization_runs',
        sa.Column('optimize_covariate_handling', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('optimization_runs', 'optimize_covariate_handling')
