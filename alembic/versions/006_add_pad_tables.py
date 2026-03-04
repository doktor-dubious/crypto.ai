"""Add pad and pad_dates tables for special-date prediction adjustments.

Revision ID: 006
Revises: 005
Create Date: 2026-03-04 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "pads",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("historic_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("allow_negative", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("boost", sa.Float(), nullable=False, server_default="0"),
        sa.Column("boost_pct", sa.Float(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pads_customer_id", "pads", ["customer_id"])

    op.create_table(
        "pad_dates",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("pad_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["pad_id"], ["pads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pad_dates_pad_id", "pad_dates", ["pad_id"])
    op.create_index("ix_pad_dates_date", "pad_dates", ["date"])


def downgrade() -> None:
    op.drop_index("ix_pad_dates_date", table_name="pad_dates")
    op.drop_index("ix_pad_dates_pad_id", table_name="pad_dates")
    op.drop_table("pad_dates")
    op.drop_index("ix_pads_customer_id", table_name="pads")
    op.drop_table("pads")
