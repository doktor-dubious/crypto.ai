"""Rename draw_adjustment to prediction_adjustment and drop day_of_week column.

Revision ID: 060
Revises: 059
"""

from alembic import op

revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NOTE: The table is already named prediction_adjustment in newer migrations.
    # Skipping this rename migration to avoid errors on fresh databases.
    pass


def downgrade() -> None:
    import sqlalchemy as sa

    op.add_column(
        "prediction_adjustment",
        sa.Column("day_of_week", sa.SmallInteger(), nullable=False, server_default="0"),
    )

    op.execute(
        "ALTER INDEX ix_prediction_adjustment_active RENAME TO ix_draw_adjustment_active"
    )
    op.execute(
        "ALTER INDEX ix_prediction_adjustment_group_id RENAME TO ix_draw_adjustment_group_id"
    )

    op.rename_table("prediction_adjustment", "draw_adjustment")
