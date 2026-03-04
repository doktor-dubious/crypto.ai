"""Add outlet_financials table for weekday-based cost and profit per outlet.

Revision ID: 005
Revises: 004
Create Date: 2026-03-04 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "outlet_financials",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("outlet_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),  # 1=Monday, 7=Sunday
        sa.Column("cost_per_unit", sa.Float(), nullable=True),
        sa.Column("profit_per_unit", sa.Float(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outlet_id", "weekday", name="uq_outlet_financials_outlet_weekday"),
    )
    op.create_index("ix_outlet_financials_outlet_id", "outlet_financials", ["outlet_id"])


def downgrade() -> None:
    op.drop_index("ix_outlet_financials_outlet_id", table_name="outlet_financials")
    op.drop_table("outlet_financials")
