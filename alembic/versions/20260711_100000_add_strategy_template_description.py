"""strategy_template: add a short description field.

The template modal shows name / description / notes on its detail side; only
name + notes existed. Adds a nullable description column.

Revision ID: 20260711_100000
Revises: 20260710_100000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op

revision = "20260711_100000"
down_revision = "20260710_100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "strategy_template",
        sa.Column("description", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("strategy_template", "description")
