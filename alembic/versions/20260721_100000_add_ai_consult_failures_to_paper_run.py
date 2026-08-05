"""paper_trade_run: add ai_consult_failures (advisor outage fail-safe).

Consecutive AI-advisor failures for the trade-confirmation gate, reset on the
first successful consultation. Past a threshold the engine stops waiting and
resolves pending trades fail-closed (verdict "ERROR"), so an advisor outage
can neither pin a gated run on "awaiting" forever nor keep burning API calls.

Revision ID: 20260721_100000
Revises: 20260720_100000
Create Date: 2026-07-08
"""

import sqlalchemy as sa

from alembic import op

revision = "20260721_100000"
down_revision = "20260720_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "paper_trade_run",
        sa.Column(
            "ai_consult_failures",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("paper_trade_run", "ai_consult_failures")
