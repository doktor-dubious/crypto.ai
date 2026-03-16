"""Rename start_date to date and drop end_date on prediction_adjustment.

Revision ID: 061
Revises: 060
"""

from alembic import op

revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("prediction_adjustment", "start_date", new_column_name="date")
    op.drop_column("prediction_adjustment", "end_date")


def downgrade() -> None:
    import sqlalchemy as sa

    op.alter_column("prediction_adjustment", "date", new_column_name="start_date")
    op.add_column(
        "prediction_adjustment",
        sa.Column("end_date", sa.Date(), nullable=False, server_default="2099-12-31"),
    )
