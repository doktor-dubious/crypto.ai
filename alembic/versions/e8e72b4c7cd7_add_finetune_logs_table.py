"""add finetune_logs table

Revision ID: e8e72b4c7cd7
Revises: 096
Create Date: 2026-03-30 12:24:38.178535

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8e72b4c7cd7'
down_revision: Union[str, None] = '096'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('finetune_logs',
    sa.Column('fine_tune_id', sa.UUID(as_uuid=False), nullable=False),
    sa.Column('level', sa.String(length=20), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('worker_name', sa.String(length=255), nullable=True),
    sa.Column('seq', sa.Integer(), nullable=False),
    sa.Column('logged_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.UUID(as_uuid=False), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['fine_tune_id'], ['fine_tunes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_finetune_logs_active'), 'finetune_logs', ['active'], unique=False)
    op.create_index(op.f('ix_finetune_logs_fine_tune_id'), 'finetune_logs', ['fine_tune_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_finetune_logs_fine_tune_id'), table_name='finetune_logs')
    op.drop_index(op.f('ix_finetune_logs_active'), table_name='finetune_logs')
    op.drop_table('finetune_logs')
