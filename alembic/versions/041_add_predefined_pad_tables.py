"""Add predefined_pad and predefined_pad_date tables.

Revision ID: 041
Revises: 040
Create Date: 2026-03-10

"""

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "041"
down_revision: Union[str, None] = "040"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "predefined_pad",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("country", sa.String(10), nullable=True),
        sa.Column("allow_negative", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_predefined_pad_name", "predefined_pad", ["name"])
    op.create_index("ix_predefined_pad_country", "predefined_pad", ["country"])

    op.create_table(
        "predefined_pad_date",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("predefined_pad_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["predefined_pad_id"], ["predefined_pad.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_predefined_pad_date_predefined_pad_id", "predefined_pad_date", ["predefined_pad_id"])


def downgrade() -> None:
    op.drop_index("ix_predefined_pad_date_predefined_pad_id", table_name="predefined_pad_date")
    op.drop_table("predefined_pad_date")
    op.drop_index("ix_predefined_pad_country", table_name="predefined_pad")
    op.drop_index("ix_predefined_pad_name", table_name="predefined_pad")
    op.drop_table("predefined_pad")
