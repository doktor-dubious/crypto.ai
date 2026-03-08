"""Add simulation_strategies table.

Revision ID: 025
Revises: 024
Create Date: 2026-03-08 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "simulation_strategies",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("customer_id", sa.dialects.postgresql.UUID(as_uuid=False), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("prediction_strategy_id", sa.dialects.postgresql.UUID(as_uuid=False), sa.ForeignKey("prediction_strategies.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("type", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("delay", sa.Integer(), nullable=False, server_default="14"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("simulation_strategies")
