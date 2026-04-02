"""Add covariate_handling to configuration tables

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-02 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'configuration',
        sa.Column('covariate_handling', sa.String(20), nullable=False, server_default='external'),
    )
    op.add_column(
        'customer_configuration',
        sa.Column('covariate_handling', sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('customer_configuration', 'covariate_handling')
    op.drop_column('configuration', 'covariate_handling')
