"""paper_trade_run: lifecycle of a running strategy template (Paper Trade page).

Revision ID: 20260714_100000
Revises: 20260713_100000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260714_100000"
down_revision = "20260713_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "paper_trade_run",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("template_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'running'"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["template_id"], ["strategy_template.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_paper_trade_run_template_id", "paper_trade_run", ["template_id"])
    op.create_index("ix_paper_trade_run_status", "paper_trade_run", ["status"])


def downgrade() -> None:
    op.drop_index("ix_paper_trade_run_status", table_name="paper_trade_run")
    op.drop_index("ix_paper_trade_run_template_id", table_name="paper_trade_run")
    op.drop_table("paper_trade_run")
