"""Add coins table

Revision ID: e195903dc18d
Revises: 2026051502
Create Date: 2026-06-02 08:34:47.791654

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e195903dc18d'
down_revision: Union[str, None] = '2026051502'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'coin',
        sa.Column('id', sa.UUID(as_uuid=False), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('type', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_coin_active', 'coin', ['active'])
    op.create_index('ix_coin_name', 'coin', ['name'])


def downgrade() -> None:
    op.drop_index('ix_coin_name', table_name='coin')
    op.drop_index('ix_coin_active', table_name='coin')
    op.drop_table('coin')
