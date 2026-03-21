"""Add finetune_progress tracking table.

Revision ID: 078
Revises: 077
Create Date: 2026-03-21

"""

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "078"
down_revision: Union[str, None] = "077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "finetune_progress",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("outlet_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("engine", sa.String(50), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("context_length", sa.Integer(), nullable=False),
        sa.Column("horizon", sa.Integer(), nullable=False),
        sa.Column("epochs", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outlet_id", "engine", name="uq_finetune_progress_outlet_engine"),
    )
    op.create_index(op.f("ix_finetune_progress_active"), "finetune_progress", ["active"])
    op.create_index(op.f("ix_finetune_progress_outlet_id"), "finetune_progress", ["outlet_id"])
    op.create_index(op.f("ix_finetune_progress_customer_id"), "finetune_progress", ["customer_id"])
    op.create_index(op.f("ix_finetune_progress_engine"), "finetune_progress", ["engine"])


def downgrade() -> None:
    op.drop_table("finetune_progress")
