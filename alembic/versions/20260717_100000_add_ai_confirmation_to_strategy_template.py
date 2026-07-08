"""strategy_template: add ai_confirmation switch.

When on, each new paper-trade entry for the template is sent to the AI trade
advisor (external research + GO / NO_GO verdict) and only executes if the
verdict is GO. Vetoed trades are still recorded (with the verdict and the
explanation) so gated vs. ungated performance stays comparable.

Revision ID: 20260717_100000
Revises: 20260716_100000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op

revision = "20260717_100000"
down_revision = "20260716_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "strategy_template",
        sa.Column(
            "ai_confirmation",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("strategy_template", "ai_confirmation")
