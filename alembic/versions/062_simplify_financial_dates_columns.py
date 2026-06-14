"""Rename start_date to date, drop end_date and weekday on financial_dates.

Revision ID: 062
Revises: 061
"""

from alembic import op

revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Disabled: columns already have correct names in fresh databases
    pass

def downgrade() -> None:
    import sqlalchemy as sa

    op.add_column(
        "financial_dates",
        sa.Column("weekday", sa.SmallInteger(), nullable=False, server_default="1"),
    )
    op.add_column(
        "financial_dates",
        sa.Column("end_date", sa.Date(), nullable=False, server_default="2099-12-31"),
    )
    op.alter_column("financial_dates", "date", new_column_name="start_date")
