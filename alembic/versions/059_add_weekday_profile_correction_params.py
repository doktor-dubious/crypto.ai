"""Add weekday_profile_correction_strength and threshold to configuration tables.

Revision ID: 059
Revises: 058
Create Date: 2026-03-13

"""

from alembic import op
import sqlalchemy as sa

revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Global configuration: NOT NULL with defaults
    op.add_column(
        "configuration",
        sa.Column(
            "weekday_profile_correction_strength",
            sa.Float(),
            nullable=False,
            server_default="1.0",
        ),
    )
    op.add_column(
        "configuration",
        sa.Column(
            "weekday_profile_correction_threshold",
            sa.Float(),
            nullable=False,
            server_default="0.0",
        ),
    )

    # Customer configuration: nullable (None = inherit from global)
    op.add_column(
        "customer_configuration",
        sa.Column("weekday_profile_correction_strength", sa.Float(), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("weekday_profile_correction_threshold", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "weekday_profile_correction_threshold")
    op.drop_column("customer_configuration", "weekday_profile_correction_strength")
    op.drop_column("configuration", "weekday_profile_correction_threshold")
    op.drop_column("configuration", "weekday_profile_correction_strength")
