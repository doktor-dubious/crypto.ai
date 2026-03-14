"""Add weekday_profile_correction to configuration and customer_configuration.

Revision ID: 055
Revises: 054
Create Date: 2026-03-13

"""

from alembic import op
import sqlalchemy as sa

revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "configuration",
        sa.Column(
            "weekday_profile_correction",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("weekday_profile_correction", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "weekday_profile_correction")
    op.drop_column("configuration", "weekday_profile_correction")
