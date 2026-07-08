"""kline_strategy.use_covariates: feed swing-signal series as model covariates.

Phase 2 of the swing/crest work: the signals the Swings tab computes
(volume/range/trade z-scores, taker tilt, streak, stretch, wicks) can be fed
to the forecast model as NATIVE covariates (TimesFM XReg). Off by default.

Revision ID: 20260707_160000
Revises: 20260707_150000
Create Date: 2026-07-05
"""

import sqlalchemy as sa
from alembic import op

revision = "20260707_160000"
down_revision = "20260707_150000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kline_strategy",
        sa.Column("use_covariates", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("kline_strategy", "use_covariates")
