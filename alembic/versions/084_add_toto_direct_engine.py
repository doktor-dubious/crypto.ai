"""Add Toto (direct) prediction engine row.

Revision ID: 084
Revises: 083
Create Date: 2026-03-23

"""

from typing import Union

from alembic import op

revision: str = "084"
down_revision: Union[str, None] = "083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000017', true, NOW(), NOW(),
            'toto',
            'Toto',
            'Datadog Toto foundation model — 151M params trained on 1T+ data points (direct, GPU required, zero-shot)'
        )
        ON CONFLICT (slug) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM prediction_engine WHERE slug = 'toto'")
