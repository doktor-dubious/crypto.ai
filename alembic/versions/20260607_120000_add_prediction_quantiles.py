"""Add quantiles + uncertainty fields to kline_simulation_prediction.

Revision ID: 20260607_120000
Revises: 20260606_140000
Create Date: 2026-06-07 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "20260607_120000"
down_revision = "20260606_140000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kline_simulation_prediction", sa.Column("prev_close", sa.Numeric(precision=20, scale=8), nullable=True))
    op.add_column("kline_simulation_prediction", sa.Column("quantiles", sa.JSON(), nullable=True))
    op.add_column("kline_simulation_prediction", sa.Column("prob_up", sa.Numeric(precision=6, scale=4), nullable=True))
    op.add_column("kline_simulation_prediction", sa.Column("in_interval", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("kline_simulation_prediction", "in_interval")
    op.drop_column("kline_simulation_prediction", "prob_up")
    op.drop_column("kline_simulation_prediction", "quantiles")
    op.drop_column("kline_simulation_prediction", "prev_close")
