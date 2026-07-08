"""kline_strategy.covariate_mode: off | native | external (replaces use_covariates).

The boolean gated the swing-signal covariates to engines with a NATIVE
model-side covariate API. The new "external" mode fits a trailing Ridge on the
pooled (signals -> next-step residual) history accumulated during the
walk-forward itself — strictly past-only, engine-agnostic — so every installed
engine can consume the signals. Existing true rows become "native".

Revision ID: 20260708_100000
Revises: 20260707_160000
Create Date: 2026-07-06
"""

import sqlalchemy as sa
from alembic import op

revision = "20260708_100000"
down_revision = "20260707_160000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kline_strategy",
        sa.Column("covariate_mode", sa.String(), nullable=False, server_default="off"),
    )
    op.execute("UPDATE kline_strategy SET covariate_mode = 'native' WHERE use_covariates")
    op.drop_column("kline_strategy", "use_covariates")


def downgrade() -> None:
    op.add_column(
        "kline_strategy",
        sa.Column("use_covariates", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.execute("UPDATE kline_strategy SET use_covariates = true WHERE covariate_mode <> 'off'")
    op.drop_column("kline_strategy", "covariate_mode")
