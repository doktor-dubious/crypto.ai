"""Add TiRex and FlowState prediction engine rows.

Revision ID: 086
Revises: 085
Create Date: 2026-03-23

"""

from typing import Union

from alembic import op

revision: str = "086"
down_revision: Union[str, None] = "085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000020', true, NOW(), NOW(),
            'tirex',
            'TiRex',
            'NX-AI TiRex xLSTM foundation model — 35M params, quantile output (CPU/GPU, zero-shot)'
        )
        ON CONFLICT (slug) DO NOTHING
    """)

    op.execute("""
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000021', true, NOW(), NOW(),
            'flowstate',
            'FlowState',
            'IBM FlowState SSM foundation model — 18.5M params, 9-quantile output (CPU/GPU, zero-shot)'
        )
        ON CONFLICT (slug) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM prediction_engine WHERE slug IN ('tirex', 'flowstate')")
