"""Add autogluon engine row to prediction_engine table.

Revision ID: 032
Revises: 031
Create Date: 2026-03-09

"""

from typing import Sequence, Union

from alembic import op

revision: str = "032"
down_revision: Union[str, None] = "031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000013', true, NOW(), NOW(),
            'autogluon',
            'AutoGluon TimesFM',
            'AutoGluon-packaged TimesFM for zero-shot time series forecasting'
        )
        ON CONFLICT (slug) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM prediction_engine WHERE slug = 'autogluon'")
