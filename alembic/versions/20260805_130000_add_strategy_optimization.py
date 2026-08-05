"""strategy_optimization + results: parameter grid searches per strategy.

The "Optimize" tab on a strategy's analytics page: backtest many variations of
one strategy across coins, timeframes and knobs, and keep what each scored.
Results carry train / validation / full-range stats separately, because ranking
thousands of combos on the full range is curve-fitting by construction.

Revision ID: 20260805_130000
Revises: 20260805_120000
Create Date: 2026-08-05
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260805_130000"
down_revision = "20260805_120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "strategy_optimization",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("strategy", sa.String(length=50), nullable=False),
        sa.Column("spec", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("seed", sa.Integer(), server_default=sa.text("42"), nullable=False),
        sa.Column("max_combos", sa.Integer(), server_default=sa.text("500"), nullable=False),
        sa.Column("sampled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("n_cartesian", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("n_total", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("n_done", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("n_skipped", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_strategy_optimization_active", "strategy_optimization", ["active"])
    op.create_index("ix_strategy_optimization_strategy", "strategy_optimization", ["strategy"])
    op.create_index("ix_strategy_optimization_status", "strategy_optimization", ["status"])

    op.create_table(
        "strategy_optimization_result",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("optimization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("coin_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("quote_asset", sa.String(length=20), nullable=False),
        sa.Column("interval", sa.String(length=10), nullable=False),
        sa.Column("params", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("is_baseline", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("n_trades", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("avg_net_bps", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("edge_t", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("win_rate_pct", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("total_return_pct", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("train_n_trades", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("train_avg_net_bps", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("train_edge_t", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("val_n_trades", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("val_avg_net_bps", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("val_edge_t", sa.Float(), server_default=sa.text("0"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["optimization_id"], ["strategy_optimization.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["coin_id"], ["coin.id"]),
    )
    op.create_index(
        "ix_strategy_optimization_result_active", "strategy_optimization_result", ["active"]
    )
    op.create_index(
        "ix_strategy_optimization_result_optimization_id",
        "strategy_optimization_result", ["optimization_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_strategy_optimization_result_optimization_id",
        table_name="strategy_optimization_result",
    )
    op.drop_index(
        "ix_strategy_optimization_result_active", table_name="strategy_optimization_result"
    )
    op.drop_table("strategy_optimization_result")
    op.drop_index("ix_strategy_optimization_status", table_name="strategy_optimization")
    op.drop_index("ix_strategy_optimization_strategy", table_name="strategy_optimization")
    op.drop_index("ix_strategy_optimization_active", table_name="strategy_optimization")
    op.drop_table("strategy_optimization")
