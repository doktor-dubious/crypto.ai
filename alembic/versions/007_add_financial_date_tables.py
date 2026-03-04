"""Add financial_dates and outlet_financial_dates tables for date-based financial overrides.

Revision ID: 007
Revises: 006
Create Date: 2026-03-04 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "financial_dates",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("method", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("copy_from_weekday", sa.SmallInteger(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_financial_dates_customer_id", "financial_dates", ["customer_id"])

    op.create_table(
        "outlet_financial_dates",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("financial_date_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("outlet_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("cost_per_unit", sa.Float(), nullable=True),
        sa.Column("profit_per_unit", sa.Float(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["financial_date_id"], ["financial_dates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_outlet_financial_dates_financial_date_id", "outlet_financial_dates", ["financial_date_id"])
    op.create_index("ix_outlet_financial_dates_outlet_id", "outlet_financial_dates", ["outlet_id"])


def downgrade() -> None:
    op.drop_index("ix_outlet_financial_dates_outlet_id", table_name="outlet_financial_dates")
    op.drop_index("ix_outlet_financial_dates_financial_date_id", table_name="outlet_financial_dates")
    op.drop_table("outlet_financial_dates")
    op.drop_index("ix_financial_dates_customer_id", table_name="financial_dates")
    op.drop_table("financial_dates")
