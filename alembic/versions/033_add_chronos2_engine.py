"""Add chronos2 engine row to prediction_engine table.

Revision ID: 033
Revises: 032
Create Date: 2026-03-09

"""

from typing import Sequence, Union

from alembic import op

revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000014', true, NOW(), NOW(),
            'chronos2',
            'AutoGluon Chronos-2',
            'Amazon Chronos-2 foundation model with native covariate support'
        )
        ON CONFLICT (slug) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM prediction_engine WHERE slug = 'chronos2'")
