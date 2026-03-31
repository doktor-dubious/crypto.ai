"""add price_history table

Revision ID: 271b9d0b651f
Revises: e8e72b4c7cd7
Create Date: 2026-03-31 11:42:07.203778

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '271b9d0b651f'
down_revision: Union[str, None] = 'e8e72b4c7cd7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('price_history',
    sa.Column('customer_id', sa.UUID(as_uuid=False), nullable=False),
    sa.Column('effective_date', sa.Date(), nullable=False),
    sa.Column('cost_per_unit', sa.Float(), nullable=True),
    sa.Column('profit_per_unit', sa.Float(), nullable=True),
    sa.Column('id', sa.UUID(as_uuid=False), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('customer_id', 'effective_date', name='uq_price_history_customer_date')
    )
    op.create_index(op.f('ix_price_history_active'), 'price_history', ['active'], unique=False)
    op.create_index(op.f('ix_price_history_customer_id'), 'price_history', ['customer_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_price_history_customer_id'), table_name='price_history')
    op.drop_index(op.f('ix_price_history_active'), table_name='price_history')
    op.drop_table('price_history')
