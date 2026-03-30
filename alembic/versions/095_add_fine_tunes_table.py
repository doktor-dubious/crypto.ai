"""Add fine_tunes table.

Revision ID: 095
Revises: 094
Create Date: 2026-03-29

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "095"
down_revision: Union[str, None] = "094"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "fine_tunes",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("customer_id", sa.dialects.postgresql.UUID(as_uuid=False), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_condition", sa.String(50), nullable=True),
        sa.Column("outlet_group_id", sa.dialects.postgresql.UUID(as_uuid=False), sa.ForeignKey("outlet_group.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("finetune_from", sa.Date(), nullable=True),
        sa.Column("finetune_to", sa.Date(), nullable=True),
        sa.Column("finetuned_outlets", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("pathological_outlets", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("worker_name", sa.String(255), nullable=True),
        sa.Column("prediction_engine_id", sa.dialects.postgresql.UUID(as_uuid=False), sa.ForeignKey("prediction_engine.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("task_id", sa.String(255), nullable=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("fine_tunes")
