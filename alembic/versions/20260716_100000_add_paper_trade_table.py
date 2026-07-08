"""paper trades: trade-level table (template snapshot + AI verdict); drop fills.

Replaces the low-level per-leg ``paper_trade_fill`` table with a consolidated,
self-contained ``paper_trade`` record — one row per round-trip trade holding
both the buy and the sell, a frozen snapshot of the strategy template it was
traded under (id / name / strategy / scope / full params), and room for an AI
verdict (GO / NO_GO) plus explanation. Also freezes the template config onto
paper_trade_run so a mid-run template edit never rewrites a running trade.

Revision ID: 20260716_100000
Revises: 20260715_100000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260716_100000"
down_revision = "20260715_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── paper_trade_run: frozen template snapshot ────────────────────────────
    op.add_column("paper_trade_run", sa.Column("template_name", sa.String(length=255), nullable=True))
    op.add_column("paper_trade_run", sa.Column("strategy", sa.String(length=50), nullable=True))
    op.add_column("paper_trade_run", sa.Column("scope", postgresql.JSON(), nullable=True))
    op.add_column("paper_trade_run", sa.Column("params", postgresql.JSON(), nullable=True))

    # Backfill snapshots for any existing runs from their template.
    op.execute(
        """
        UPDATE paper_trade_run r
        SET template_name = t.name,
            strategy = t.strategy,
            scope = t.scope,
            params = t.params
        FROM strategy_template t
        WHERE t.id = r.template_id
        """
    )

    # ── drop the obsolete per-leg fills table ────────────────────────────────
    op.drop_table("paper_trade_fill")

    # ── paper_trade: consolidated trade record ───────────────────────────────
    op.create_table(
        "paper_trade",
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
        sa.Column("template_id", sa.String(), nullable=True),
        sa.Column("template_name", sa.String(length=255), nullable=True),
        sa.Column("strategy", sa.String(length=50), nullable=True),
        sa.Column("scope", postgresql.JSON(), nullable=True),
        sa.Column("params", postgresql.JSON(), nullable=True),
        sa.Column("ai_verdict", sa.String(length=8), nullable=True),
        sa.Column("ai_explanation", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["paper_trade_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "trade_seq", name="uq_paper_trade_run_seq"),
    )
    op.create_index("ix_paper_trade_run_id", "paper_trade", ["run_id"])
    op.create_index("ix_paper_trade_active", "paper_trade", ["active"])


def downgrade() -> None:
    op.drop_table("paper_trade")

    # Recreate the fills table (structure only; data is not restored).
    op.create_table(
        "paper_trade_fill",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
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

    for col in ("params", "scope", "strategy", "template_name"):
        op.drop_column("paper_trade_run", col)
