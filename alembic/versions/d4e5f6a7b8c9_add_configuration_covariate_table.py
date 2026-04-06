"""Add configuration_covariate table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b9
Create Date: 2026-04-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'configuration_covariate',
        sa.Column('id', UUID(as_uuid=False), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('customer_id', UUID(as_uuid=False), sa.ForeignKey('customers.id', ondelete='CASCADE'), nullable=True, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('type', sa.SmallInteger(), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('customer_id', 'type', name='uq_config_covariate_customer_type'),
    )

    # Seed global defaults (customer_id = NULL)
    op.execute(sa.text(
        "INSERT INTO configuration_covariate (id, customer_id, name, description, type, active)"
        " VALUES"
        " (gen_random_uuid(), NULL, 'Weekday',"
        " 'Weekday one-hot dummies (Mon–Sun). Captures recurring day-of-week demand patterns"
        " — e.g. higher sales on Fridays, lower on Mondays. Each enabled weekday gets its own"
        " binary feature in the Ridge regression.', 1, true),"
        " (gen_random_uuid(), NULL, 'Selling Price',"
        " 'Selling price covariate. Captures the relationship between price changes and demand"
        " volume. When prices rise, demand typically drops (and vice versa). Uses historical"
        " price-to-sales correlation to adjust forecasts.', 2, true),"
        " (gen_random_uuid(), NULL, 'PAD Events',"
        " 'Planned Activity Date indicators. Binary flags for known events (holidays, promotions,"
        " campaigns) that cause demand spikes or drops. Each PAD type gets its own feature so the"
        " model learns event-specific effects.', 3, true)"
        " ON CONFLICT DO NOTHING"
    ))


def downgrade() -> None:
    op.drop_table('configuration_covariate')
