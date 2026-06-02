"""Add pad_history_days to configuration tables

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-04-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuration",
        sa.Column(
            "pad_history_days",
            sa.Integer(),
            nullable=False,
            server_default="730",
        ),
    )
    op.add_column(
        "customer_configuration",
        sa.Column("pad_history_days", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customer_configuration", "pad_history_days")
    op.drop_column("configuration", "pad_history_days")
