"""Add weekday_only_* columns to configuration and customer_configuration.

Revision ID: 054
Revises: 053
Create Date: 2026-03-13

"""

from alembic import op
import sqlalchemy as sa

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None

_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def upgrade() -> None:
    # Global configuration: NOT NULL with default False
    for day in _DAYS:
        op.add_column(
            "configuration",
            sa.Column(
                f"weekday_only_{day}",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )

    # Customer configuration: nullable (None = inherit from global)
    for day in _DAYS:
        op.add_column(
            "customer_configuration",
            sa.Column(f"weekday_only_{day}", sa.Boolean(), nullable=True),
        )


def downgrade() -> None:
    for day in _DAYS:
        op.drop_column("customer_configuration", f"weekday_only_{day}")
    for day in _DAYS:
        op.drop_column("configuration", f"weekday_only_{day}")
