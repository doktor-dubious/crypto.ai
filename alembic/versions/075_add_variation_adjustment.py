"""Add variation_adjustment and variation_history_days to configuration tables.

Revision ID: 075
Revises: 074
"""

from alembic import op
import sqlalchemy as sa

revision = "075"
down_revision = "074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "configuration",
        sa.Column(
            "variation_adjustment",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "configuration",
        sa.Column(
            "variation_history_days",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("365"),
        ),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("variation_adjustment", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("variation_history_days", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "variation_history_days")
    op.drop_column("customer_configuration", "variation_adjustment")
    op.drop_column("configuration", "variation_history_days")
    op.drop_column("configuration", "variation_adjustment")
