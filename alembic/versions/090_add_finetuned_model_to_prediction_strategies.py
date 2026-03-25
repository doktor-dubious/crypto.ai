"""Add finetuned_model to prediction_strategies.

Stores the name of the finetuned model subdirectory to use for predictions.
NULL means use the base (non-finetuned) model.

Revision ID: 090
Revises: 089
Create Date: 2026-03-25

"""

from alembic import op
import sqlalchemy as sa

revision = "090"
down_revision = "089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prediction_strategies",
        sa.Column("finetuned_model", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("prediction_strategies", "finetuned_model")
