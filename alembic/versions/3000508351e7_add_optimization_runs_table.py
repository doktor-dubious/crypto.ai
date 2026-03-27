"""add optimization_runs table

Revision ID: 3000508351e7
Revises: 092
Create Date: 2026-03-27 15:42:03.042788

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '3000508351e7'
down_revision: Union[str, None] = '092'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('optimization_runs',
    sa.Column('customer_id', sa.UUID(as_uuid=False), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('task_id', sa.String(length=255), nullable=True),
    sa.Column('status', sa.String(length=50), server_default='pending', nullable=False),
    sa.Column('optimize_variation_adjustment', sa.Boolean(), nullable=False),
    sa.Column('optimize_eo_methodology', sa.Boolean(), nullable=False),
    sa.Column('optimize_eo_extrapolation', sa.Boolean(), nullable=False),
    sa.Column('optimize_weekday_profile_correction', sa.Boolean(), nullable=False),
    sa.Column('simulation_days', sa.Integer(), nullable=False),
    sa.Column('delay', sa.Integer(), nullable=False),
    sa.Column('simulation_from', sa.Date(), nullable=True),
    sa.Column('simulation_to', sa.Date(), nullable=True),
    sa.Column('results', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    sa.Column('best_combination', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    sa.Column('best_score', sa.Float(), nullable=True),
    sa.Column('total_combinations', sa.Integer(), nullable=False),
    sa.Column('completed_combinations', sa.Integer(), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.UUID(as_uuid=False), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_optimization_runs_active'), 'optimization_runs', ['active'], unique=False)
    op.create_index(op.f('ix_optimization_runs_customer_id'), 'optimization_runs', ['customer_id'], unique=False)
    op.create_index(op.f('ix_optimization_runs_task_id'), 'optimization_runs', ['task_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_optimization_runs_task_id'), table_name='optimization_runs')
    op.drop_index(op.f('ix_optimization_runs_customer_id'), table_name='optimization_runs')
    op.drop_index(op.f('ix_optimization_runs_active'), table_name='optimization_runs')
    op.drop_table('optimization_runs')
