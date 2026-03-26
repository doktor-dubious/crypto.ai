"""Add simulation_filters table.

Revision ID: 091
Revises: 090
Create Date: 2026-03-25

"""

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "091"
down_revision: Union[str, None] = "090"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "simulation_filters",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_simulation_filters_active", "simulation_filters", ["active"])
    op.create_index("ix_simulation_filters_customer_id", "simulation_filters", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_simulation_filters_customer_id", table_name="simulation_filters")
    op.drop_index("ix_simulation_filters_active", table_name="simulation_filters")
    op.drop_table("simulation_filters")
