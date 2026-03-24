"""Add YingLong and Kairos prediction engine rows.

Revision ID: 085
Revises: 084
Create Date: 2026-03-23

"""

from typing import Union

from alembic import op

revision: str = "085"
down_revision: Union[str, None] = "084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000018', true, NOW(), NOW(),
            'yinglong',
            'YingLong',
            'Alibaba YingLong foundation model — 300M params, 100-quantile output, pre-trained on 78B time points (GPU required, zero-shot)'
        )
        ON CONFLICT (slug) DO NOTHING
    """)

    op.execute("""
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES (
            '00000000-0000-0000-0000-000000000019', true, NOW(), NOW(),
            'kairos',
            'Kairos',
            'ShanghaiTech Kairos foundation model — 50M params, quantile output, pre-trained on 300B+ time points (CPU/GPU, zero-shot)'
        )
        ON CONFLICT (slug) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM prediction_engine WHERE slug IN ('yinglong', 'kairos')")
