"""Add cv column to prediction_outlets and last_prediction.

Revision ID: 076
Revises: 075
"""

from alembic import op
import sqlalchemy as sa

revision = "076"
down_revision = "075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prediction_outlets",
        sa.Column("cv", sa.Float(), nullable=True),
    )
    op.add_column(
        "last_prediction",
        sa.Column("cv", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("last_prediction", "cv")
    op.drop_column("prediction_outlets", "cv")
