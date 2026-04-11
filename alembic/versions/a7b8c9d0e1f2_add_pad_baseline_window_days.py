"""Add pad_baseline_window_days to configuration tables

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuration",
        sa.Column(
            "pad_baseline_window_days",
            sa.Integer(),
            nullable=False,
            server_default="56",
        ),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("pad_baseline_window_days", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "pad_baseline_window_days")
    op.drop_column("configuration", "pad_baseline_window_days")
