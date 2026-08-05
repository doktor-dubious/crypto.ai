"""live trading: run / trade / equity tables (Binance Spot testnet execution).

The live twins of the paper-trade trio. A live run holds real exchange state
(quote cash slice, actual filled position) instead of a replayed cache; a live
trade records the actual Binance order ids, fill prices, quantities and
commissions; equity snapshots work exactly like paper's (P/L differencing +
equity curve).

Revision ID: 20260722_100000
Revises: 20260721_100000
Create Date: 2026-07-09
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260722_100000"
down_revision = "20260721_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_trade_run",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("template_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("template_name", sa.String(length=255), nullable=True),
        sa.Column("strategy", sa.String(length=50), nullable=True),
        sa.Column("scope", postgresql.JSON(), nullable=True),
        sa.Column("params", postgresql.JSON(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'running'"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_testnet", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("initial_capital", sa.Float(), server_default=sa.text("100"), nullable=False),
        sa.Column("cash_quote", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("equity", sa.Float(), nullable=True),
        sa.Column("open_side", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("open_qty", sa.Float(), nullable=True),
        sa.Column("open_entry_price", sa.Float(), nullable=True),
        sa.Column("open_entry_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("open_entry_quote", sa.Float(), nullable=True),
        sa.Column("n_closed_trades", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_bar_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_trade_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_step_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("ai_consult_failures", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.ForeignKeyConstraint(["template_id"], ["strategy_template.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_live_trade_run_template_id", "live_trade_run", ["template_id"])
    op.create_index("ix_live_trade_run_status", "live_trade_run", ["status"])
    op.create_index("ix_live_trade_run_active", "live_trade_run", ["active"])

    op.create_table(
        "live_trade",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("trade_seq", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=8), server_default=sa.text("'open'"), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("qty", sa.Float(), nullable=False),
        sa.Column("entry_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entry_price", sa.Float(), nullable=False),
        sa.Column("exit_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exit_price", sa.Float(), nullable=True),
        sa.Column("fee_bps", sa.Float(), nullable=True),
        sa.Column("ret", sa.Float(), nullable=True),
        sa.Column("realized_pnl", sa.Float(), nullable=True),
        sa.Column("exit_reason", sa.String(length=16), nullable=True),
        sa.Column("signal_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entry_order_id", sa.BigInteger(), nullable=True),
        sa.Column("exit_order_id", sa.BigInteger(), nullable=True),
        sa.Column("entry_commission", sa.Float(), nullable=True),
        sa.Column("exit_commission", sa.Float(), nullable=True),
        sa.Column("template_id", sa.String(), nullable=True),
        sa.Column("template_name", sa.String(length=255), nullable=True),
        sa.Column("strategy", sa.String(length=50), nullable=True),
        sa.Column("scope", postgresql.JSON(), nullable=True),
        sa.Column("params", postgresql.JSON(), nullable=True),
        sa.Column("ai_verdict", sa.String(length=8), nullable=True),
        sa.Column("ai_explanation", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["live_trade_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "trade_seq", name="uq_live_trade_run_seq"),
    )
    op.create_index("ix_live_trade_run_id", "live_trade", ["run_id"])
    op.create_index("ix_live_trade_active", "live_trade", ["active"])

    op.create_table(
        "live_trade_equity",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("bar_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("equity", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["live_trade_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "bar_time", name="uq_live_equity_run_bar"),
    )
    op.create_index("ix_live_trade_equity_run_id", "live_trade_equity", ["run_id"])
    op.create_index("ix_live_trade_equity_bar_time", "live_trade_equity", ["bar_time"])
    op.create_index("ix_live_trade_equity_active", "live_trade_equity", ["active"])


def downgrade() -> None:
    op.drop_table("live_trade_equity")
    op.drop_table("live_trade")
    op.drop_table("live_trade_run")
