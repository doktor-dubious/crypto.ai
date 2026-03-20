"""Add quantile columns to prediction_outlets and change more_sale to float.

Revision ID: 072
Revises: 071
"""

from alembic import op
import sqlalchemy as sa

revision = "072"
down_revision = "071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add quantile columns (P20–P80) to prediction_outlets
    # P10 = lower_bound, P90 = upper_bound (already exist)
    for q in ("q20", "q30", "q40", "q50", "q60", "q70", "q80"):
        op.add_column("prediction_outlets", sa.Column(q, sa.Float(), nullable=True))

    # Change more_sale fields from Integer to Float on simulations
    for col in ("d_more_sale", "p_more_sale", "eo_more_sale"):
        op.alter_column(
            "simulations",
            col,
            existing_type=sa.Integer(),
            type_=sa.Float(),
            existing_nullable=True,
        )


def downgrade() -> None:
    for col in ("d_more_sale", "p_more_sale", "eo_more_sale"):
        op.alter_column(
            "simulations",
            col,
            existing_type=sa.Float(),
            type_=sa.Integer(),
            existing_nullable=True,
        )

    for q in ("q80", "q70", "q60", "q50", "q40", "q30", "q20"):
        op.drop_column("prediction_outlets", q)
