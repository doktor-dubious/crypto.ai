"""add llm_submodel table and insight_model insight_submodel to configuration

Revision ID: a1b2c3d4e5f6
Revises: 89e0a6e7ec6f
Create Date: 2026-04-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '89e0a6e7ec6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create llm_submodel table
    op.create_table('llm_submodel',
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('llm_id', sa.UUID(as_uuid=False), nullable=True),
        sa.Column('id', sa.UUID(as_uuid=False), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['llm_id'], ['llm.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_llm_submodel_active'), 'llm_submodel', ['active'], unique=False)
    op.create_index(op.f('ix_llm_submodel_llm_id'), 'llm_submodel', ['llm_id'], unique=False)

    # Insert default submodels
    op.execute("""
        INSERT INTO llm_submodel (id, name) VALUES
            (gen_random_uuid(), 'Opus'),
            (gen_random_uuid(), 'Sonnet'),
            (gen_random_uuid(), 'Haiku')
    """)

    # Add insight_model_id and insight_submodel_id to configuration
    op.add_column('configuration', sa.Column('insight_model_id', sa.UUID(as_uuid=False), nullable=True))
    op.add_column('configuration', sa.Column('insight_submodel_id', sa.UUID(as_uuid=False), nullable=True))
    op.create_index(op.f('ix_configuration_insight_model_id'), 'configuration', ['insight_model_id'], unique=False)
    op.create_index(op.f('ix_configuration_insight_submodel_id'), 'configuration', ['insight_submodel_id'], unique=False)
    op.create_foreign_key('fk_configuration_insight_model_id', 'configuration', 'llm', ['insight_model_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key('fk_configuration_insight_submodel_id', 'configuration', 'llm_submodel', ['insight_submodel_id'], ['id'], ondelete='SET NULL')

    # Add insight_model_id and insight_submodel_id to customer_configuration
    op.add_column('customer_configuration', sa.Column('insight_model_id', sa.UUID(as_uuid=False), nullable=True))
    op.add_column('customer_configuration', sa.Column('insight_submodel_id', sa.UUID(as_uuid=False), nullable=True))
    op.create_index(op.f('ix_customer_configuration_insight_model_id'), 'customer_configuration', ['insight_model_id'], unique=False)
    op.create_index(op.f('ix_customer_configuration_insight_submodel_id'), 'customer_configuration', ['insight_submodel_id'], unique=False)
    op.create_foreign_key('fk_customer_configuration_insight_model_id', 'customer_configuration', 'llm', ['insight_model_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key('fk_customer_configuration_insight_submodel_id', 'customer_configuration', 'llm_submodel', ['insight_submodel_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    # Drop FKs and columns from customer_configuration
    op.drop_constraint('fk_customer_configuration_insight_submodel_id', 'customer_configuration', type_='foreignkey')
    op.drop_constraint('fk_customer_configuration_insight_model_id', 'customer_configuration', type_='foreignkey')
    op.drop_index(op.f('ix_customer_configuration_insight_submodel_id'), table_name='customer_configuration')
    op.drop_index(op.f('ix_customer_configuration_insight_model_id'), table_name='customer_configuration')
    op.drop_column('customer_configuration', 'insight_submodel_id')
    op.drop_column('customer_configuration', 'insight_model_id')

    # Drop FKs and columns from configuration
    op.drop_constraint('fk_configuration_insight_submodel_id', 'configuration', type_='foreignkey')
    op.drop_constraint('fk_configuration_insight_model_id', 'configuration', type_='foreignkey')
    op.drop_index(op.f('ix_configuration_insight_submodel_id'), table_name='configuration')
    op.drop_index(op.f('ix_configuration_insight_model_id'), table_name='configuration')
    op.drop_column('configuration', 'insight_submodel_id')
    op.drop_column('configuration', 'insight_model_id')

    # Drop llm_submodel table
    op.drop_index(op.f('ix_llm_submodel_llm_id'), table_name='llm_submodel')
    op.drop_index(op.f('ix_llm_submodel_active'), table_name='llm_submodel')
    op.drop_table('llm_submodel')
