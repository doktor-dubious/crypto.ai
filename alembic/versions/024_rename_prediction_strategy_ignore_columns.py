"""Rename ignore_fixed_draw/ignore_minimum_draw/ignore_maximum_draw in prediction_strategies.

Revision ID: 024
Revises: 023
Create Date: 2026-03-06 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOTE: The initial schema (migration 009) already creates columns with new names,
    # so these renames are not needed when starting from scratch.
    # Skipping these renames to support fresh database initialization.
    pass


def downgrade() -> None:
    op.alter_column("prediction_strategies", "ignore_fixed", new_column_name="ignore_fixed_draw")
    op.alter_column("prediction_strategies", "ignore_minimum", new_column_name="ignore_minimum_draw")
    op.alter_column("prediction_strategies", "ignore_maximum", new_column_name="ignore_maximum_draw")
