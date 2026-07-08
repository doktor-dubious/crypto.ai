"""paper-trade engine: run engine-state columns + fills + equity snapshots.

Adds the execution/P/L engine's persistence: denormalised engine state on
paper_trade_run (equity, open position, trade count, bar cursor), a
paper_trade_fill audit log (one row per entry/exit leg, idempotent on
run/seq/leg), and paper_trade_equity mark-to-market snapshots (one per bar,
differenced into the time-bucketed P/L).

Revision ID: 20260715_100000
Revises: 20260714_100000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260715_100000"
down_revision = "20260714_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── paper_trade_run: engine-state cache ──────────────────────────────────
    op.add_column(
        "paper_trade_run",
        sa.Column("initial_capital", sa.Float(), server_default=sa.text("10000"), nullable=False),
    )
    op.add_column("paper_trade_run", sa.Column("equity", sa.Float(), nullable=True))
    op.add_column("paper_trade_run", sa.Column("realized_equity", sa.Float(), nullable=True))
    op.add_column(
        "paper_trade_run",
        sa.Column("open_side", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("paper_trade_run", sa.Column("open_entry_price", sa.Float(), nullable=True))
    op.add_column(
        "paper_trade_run",
        sa.Column("open_entry_time", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "paper_trade_run",
        sa.Column("n_closed_trades", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "paper_trade_run",
        sa.Column("last_bar_time", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "paper_trade_run",
        sa.Column("last_step_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("paper_trade_run", sa.Column("error", sa.String(), nullable=True))

    # ── paper_trade_fill ─────────────────────────────────────────────────────
    op.create_table(
        "paper_trade_fill",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("trade_seq", sa.Integer(), nullable=False),
        sa.Column("leg", sa.String(length=8), nullable=False),
        sa.Column("bar_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("qty", sa.Float(), nullable=False),
        sa.Column("ret", sa.Float(), nullable=True),
        sa.Column("realized_pnl", sa.Float(), nullable=True),
        sa.Column("reason", sa.String(length=16), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["paper_trade_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "trade_seq", "leg", name="uq_paper_fill_run_seq_leg"),
    )
    op.create_index("ix_paper_trade_fill_run_id", "paper_trade_fill", ["run_id"])
    op.create_index("ix_paper_trade_fill_active", "paper_trade_fill", ["active"])

    # ── paper_trade_equity ───────────────────────────────────────────────────
    op.create_table(
        "paper_trade_equity",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("bar_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("equity", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["paper_trade_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "bar_time", name="uq_paper_equity_run_bar"),
    )
    op.create_index("ix_paper_trade_equity_run_id", "paper_trade_equity", ["run_id"])
    op.create_index("ix_paper_trade_equity_bar_time", "paper_trade_equity", ["bar_time"])
    op.create_index("ix_paper_trade_equity_active", "paper_trade_equity", ["active"])


def downgrade() -> None:
    op.drop_table("paper_trade_equity")
    op.drop_table("paper_trade_fill")
    for col in (
        "error", "last_step_at", "last_bar_time", "n_closed_trades",
        "open_entry_time", "open_entry_price", "open_side",
        "realized_equity", "equity", "initial_capital",
    ):
        op.drop_column("paper_trade_run", col)
