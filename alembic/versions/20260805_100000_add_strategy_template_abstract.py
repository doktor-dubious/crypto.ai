"""strategy_template: add is_abstract (scope-free strategies).

An ABSTRACT strategy is a parameter set with no coin / trading pair / timeframe
of its own — the scope is chosen when a paper run is started. A normal strategy
is pinned to the scope it was created with and cannot trade anything else.
Existing rows are all concrete, so the default is false.

Revision ID: 20260805_100000
Revises: 20260803_100000
Create Date: 2026-08-05
"""

import sqlalchemy as sa

from alembic import op

revision = "20260805_100000"
down_revision = "20260803_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "strategy_template",
        sa.Column(
            "is_abstract",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_strategy_template_is_abstract", "strategy_template", ["is_abstract"]
    )


def downgrade() -> None:
    op.drop_index("ix_strategy_template_is_abstract", table_name="strategy_template")
    op.drop_column("strategy_template", "is_abstract")
