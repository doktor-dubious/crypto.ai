"""Dedupe klines and enforce uniqueness per (coin, quote, interval, open_time).

Imports previously did a blind insert with no unique constraint, so overlapping
import ranges duplicated bars (BTC/USDT 1h had ~42% duplicate rows), silently
corrupting every walk-forward simulation on the affected pair.  This migration
removes duplicates (keeping one arbitrary row per bar — duplicate rows carry
identical Binance data) and replaces the non-unique composite index with a
unique one so the importer can upsert with ON CONFLICT DO NOTHING.

Revision ID: 20260702_100000
Revises: 20260701_120000
Create Date: 2026-07-02
"""

from alembic import op

revision = "20260702_100000"
down_revision = "20260701_120000"
branch_labels = None
depends_on = None

INDEX_NAME = "idx_kline_coin_quote_interval_time"
COLUMNS = ["coin_id", "quote_asset", "interval", "open_time"]


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM klines a
        USING klines b
        WHERE a.ctid < b.ctid
          AND a.coin_id = b.coin_id
          AND a.quote_asset = b.quote_asset
          AND a.interval = b.interval
          AND a.open_time = b.open_time
        """
    )
    op.drop_index(INDEX_NAME, table_name="klines")
    op.create_index(INDEX_NAME, "klines", COLUMNS, unique=True)


def downgrade() -> None:
    # Deleted duplicate rows are not restorable (and shouldn't be).
    op.drop_index(INDEX_NAME, table_name="klines")
    op.create_index(INDEX_NAME, "klines", COLUMNS, unique=False)
