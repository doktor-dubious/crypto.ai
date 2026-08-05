"""coin: add has_spot / has_futures market-availability flags.

Records which Binance markets list a coin so the trading strategy pages can
restrict the fee-model dropdown (spot-taker needs a spot market; futures
maker/taker need a USDⓈ-M perpetual). NULL until first refreshed.

Revision ID: 20260719_100000
Revises: 20260718_100000
Create Date: 2026-07-08
"""

import sqlalchemy as sa
from alembic import op

revision = "20260719_100000"
down_revision = "20260718_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("coin", sa.Column("has_spot", sa.Boolean(), nullable=True))
    op.add_column("coin", sa.Column("has_futures", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("coin", "has_futures")
    op.drop_column("coin", "has_spot")
