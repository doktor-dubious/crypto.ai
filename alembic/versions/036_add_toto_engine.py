"""Add Toto prediction engine row.

Revision ID: 036
Revises: 035
Create Date: 2026-03-09

"""

from typing import Union

from alembic import op

revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000015', true, NOW(), NOW(),
            'gluon-toto',
            'AutoGluon Toto',
            'Datadog Toto foundation model via AutoGluon (GPU required, zero-shot)'
        )
        ON CONFLICT (slug) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM prediction_engine WHERE slug = 'gluon-toto'")
