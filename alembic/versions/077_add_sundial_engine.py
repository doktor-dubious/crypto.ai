"""Add Sundial prediction engine row.

Revision ID: 077
Revises: 076
Create Date: 2026-03-20

"""

from typing import Union

from alembic import op

revision: str = "077"
down_revision: Union[str, None] = "076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000016', true, NOW(), NOW(),
            'sundial',
            'Sundial',
            'THU-ML Sundial foundation model — generative probabilistic time series forecasting (128M params, zero-shot)'
        )
        ON CONFLICT (slug) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM prediction_engine WHERE slug = 'sundial'")
