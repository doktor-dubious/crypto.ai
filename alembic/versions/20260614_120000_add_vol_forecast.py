"""Add pred_vol/realized_vol to kline_simulation_prediction.

Revision ID: 20260614_120000
Revises: 20260613_120000
Create Date: 2026-06-14
"""

import sqlalchemy as sa
from alembic import op

revision = "20260614_120000"
down_revision = "20260613_120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kline_simulation_prediction",
        sa.Column("pred_vol", sa.Numeric(precision=20, scale=10), nullable=True),
    )
    op.add_column(
        "kline_simulation_prediction",
        sa.Column("realized_vol", sa.Numeric(precision=20, scale=10), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("kline_simulation_prediction", "realized_vol")
    op.drop_column("kline_simulation_prediction", "pred_vol")
