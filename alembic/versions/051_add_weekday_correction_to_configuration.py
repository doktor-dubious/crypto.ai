"""Add weekday_correction_* columns to configuration and customer_configuration.

Revision ID: 051
Revises: 050
Create Date: 2026-03-12

"""

from alembic import op
import sqlalchemy as sa

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None

_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def upgrade() -> None:
    # Global configuration: NOT NULL with default True
    for day in _DAYS:
        op.add_column(
            "configuration",
            sa.Column(
                f"weekday_correction_{day}",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )

    # Customer configuration: nullable (None = inherit from global)
    for day in _DAYS:
        op.add_column(
            "customer_configuration",
            sa.Column(f"weekday_correction_{day}", sa.Boolean(), nullable=True),
        )


def downgrade() -> None:
    for day in _DAYS:
        op.drop_column("customer_configuration", f"weekday_correction_{day}")
    for day in _DAYS:
        op.drop_column("configuration", f"weekday_correction_{day}")
