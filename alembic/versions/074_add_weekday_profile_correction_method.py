"""Add weekday_profile_correction_method to configuration and customer_configuration.

Revision ID: 074
Revises: 073
"""

from alembic import op
import sqlalchemy as sa

revision = "074"
down_revision = "073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "configuration",
        sa.Column(
            "weekday_profile_correction_method",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("weekday_profile_correction_method", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "weekday_profile_correction_method")
    op.drop_column("configuration", "weekday_profile_correction_method")
