"""strategy_optimization_result: payoff SHAPE, not just size.

t and Sharpe both assume roughly symmetric returns, so they mis-rank the two
payoff profiles that matter most in practice:

  * many small losses, rare large win (trend/breakout) — penalised, because the
    rare win inflates the denominator;
  * many small wins, rare large loss (mean reversion — which is what streak
    reversion IS) — flattered, right up until the rare loss lands.

Skew names that shape directly; max drawdown and the worst single trade say how
bad the bad case actually got. Nullable rather than defaulted to 0: results
recorded before this migration genuinely don't know, and a 0 would read as
"symmetric, no drawdown" — the most flattering possible lie.

Revision ID: 20260805_140000
Revises: 20260805_130000
Create Date: 2026-08-05
"""

import sqlalchemy as sa

from alembic import op

revision = "20260805_140000"
down_revision = "20260805_130000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col in ("skew", "max_drawdown_pct", "worst_trade_bps"):
        op.add_column(
            "strategy_optimization_result", sa.Column(col, sa.Float(), nullable=True)
        )


def downgrade() -> None:
    for col in ("skew", "max_drawdown_pct", "worst_trade_bps"):
        op.drop_column("strategy_optimization_result", col)
