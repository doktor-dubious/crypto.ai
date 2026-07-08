"""strategy_template: saved parameter templates for trading strategies.

A global (non-tenant) table holding a named JSON bundle of one strategy's signal
parameters, loadable/editable on the strategy's Analytics page and later applied
on Paper Trade. Scope (coin/pair/timeframe) is intentionally not stored.

Revision ID: 20260710_100000
Revises: 20260709_100000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260710_100000"
down_revision = "20260709_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "strategy_template",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("strategy", sa.String(length=50), nullable=False),
        sa.Column("params", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_strategy_template_active", "strategy_template", ["active"])
    op.create_index("ix_strategy_template_strategy", "strategy_template", ["strategy"])


def downgrade() -> None:
    op.drop_index("ix_strategy_template_strategy", table_name="strategy_template")
    op.drop_index("ix_strategy_template_active", table_name="strategy_template")
    op.drop_table("strategy_template")
