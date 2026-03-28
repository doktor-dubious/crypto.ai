"""add finetune_examinations table

Revision ID: 74bf96494e87
Revises: d6ed0f734f7f
Create Date: 2026-03-28 15:10:18.967705

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '74bf96494e87'
down_revision: Union[str, None] = 'd6ed0f734f7f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('finetune_examinations',
    sa.Column('customer_id', sa.UUID(as_uuid=False), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('simulation_from', sa.Date(), nullable=True),
    sa.Column('simulation_to', sa.Date(), nullable=True),
    sa.Column('delay', sa.SmallInteger(), nullable=True),
    sa.Column('outlet_group_id', sa.UUID(as_uuid=False), nullable=True),
    sa.Column('prediction_strategy_id', sa.UUID(as_uuid=False), nullable=True),
    sa.Column('base_engine', sa.String(length=255), nullable=True),
    sa.Column('finetuned_engine', sa.String(length=255), nullable=True),
    sa.Column('finetuned_model', sa.String(length=255), nullable=True),
    sa.Column('base_simulation_id', sa.UUID(as_uuid=False), nullable=True),
    sa.Column('finetuned_simulation_id', sa.UUID(as_uuid=False), nullable=True),
    sa.Column('status', sa.String(length=50), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('task_id', sa.String(length=255), nullable=True),
    sa.Column('base_stats', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    sa.Column('finetuned_stats', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    sa.Column('base_zero_shot', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    sa.Column('finetuned_zero_shot', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    sa.Column('base_overview', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    sa.Column('finetuned_overview', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    sa.Column('conclusion', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(as_uuid=False), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['base_simulation_id'], ['simulations.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['finetuned_simulation_id'], ['simulations.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['outlet_group_id'], ['outlet_group.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['prediction_strategy_id'], ['prediction_strategies.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_finetune_examinations_active'), 'finetune_examinations', ['active'], unique=False)
    op.create_index(op.f('ix_finetune_examinations_base_simulation_id'), 'finetune_examinations', ['base_simulation_id'], unique=False)
    op.create_index(op.f('ix_finetune_examinations_customer_id'), 'finetune_examinations', ['customer_id'], unique=False)
    op.create_index(op.f('ix_finetune_examinations_finetuned_simulation_id'), 'finetune_examinations', ['finetuned_simulation_id'], unique=False)
    op.create_index(op.f('ix_finetune_examinations_outlet_group_id'), 'finetune_examinations', ['outlet_group_id'], unique=False)
    op.create_index(op.f('ix_finetune_examinations_prediction_strategy_id'), 'finetune_examinations', ['prediction_strategy_id'], unique=False)
    op.create_index(op.f('ix_finetune_examinations_task_id'), 'finetune_examinations', ['task_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_finetune_examinations_task_id'), table_name='finetune_examinations')
    op.drop_index(op.f('ix_finetune_examinations_prediction_strategy_id'), table_name='finetune_examinations')
    op.drop_index(op.f('ix_finetune_examinations_outlet_group_id'), table_name='finetune_examinations')
    op.drop_index(op.f('ix_finetune_examinations_finetuned_simulation_id'), table_name='finetune_examinations')
    op.drop_index(op.f('ix_finetune_examinations_customer_id'), table_name='finetune_examinations')
    op.drop_index(op.f('ix_finetune_examinations_base_simulation_id'), table_name='finetune_examinations')
    op.drop_index(op.f('ix_finetune_examinations_active'), table_name='finetune_examinations')
    op.drop_table('finetune_examinations')
