"""Add weekday_correction to last_prediction and correction_* to prediction_outlets.

Revision ID: 052
Revises: 051
Create Date: 2026-03-12

"""

from alembic import op
import sqlalchemy as sa

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None

_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def upgrade() -> None:
    # last_prediction: single correction value per row (row is already per-weekday)
    op.add_column(
        "last_prediction",
        sa.Column("weekday_correction", sa.Float(), nullable=True),
    )

    # prediction_outlets: one column per weekday
    for day in _DAYS:
        op.add_column(
            "prediction_outlets",
            sa.Column(f"correction_{day}", sa.Float(), nullable=True),
        )


def downgrade() -> None:
    for day in _DAYS:
        op.drop_column("prediction_outlets", f"correction_{day}")
    op.drop_column("last_prediction", "weekday_correction")
