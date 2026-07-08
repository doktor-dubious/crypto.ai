"""Add score column to kline_simulation.

A single parameter-free "skill" number in [-1, 1] for ranking simulation runs on
the completed-simulations master table: the directional return IC, or the
volatility-forecast correlation for vol runs. Indexed for sorting.

Revision ID: 20260705_120000
Revises: 20260702_120000
Create Date: 2026-07-05
"""

import sqlalchemy as sa

from alembic import op

revision = "20260705_120000"
down_revision = "20260702_120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kline_simulation", sa.Column("score", sa.Float(), nullable=True))
    op.create_index(
        op.f("ix_kline_simulation_score"), "kline_simulation", ["score"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_kline_simulation_score"), table_name="kline_simulation")
    op.drop_column("kline_simulation", "score")
