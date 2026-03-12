"""Add covariates and covariate_outlet tables.

Revision ID: 045
Revises: 044
Create Date: 2026-03-11

"""

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "045"
down_revision: Union[str, None] = "044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "covariates",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("pad_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["pad_id"], ["pads.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_covariates_pad_id", "covariates", ["pad_id"])

    op.create_table(
        "covariate_outlet",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("covariate_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("outlet_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("task_id", sa.String(255), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("coefficient", sa.Float(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["covariate_id"], ["covariates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_covariate_outlet_covariate_id", "covariate_outlet", ["covariate_id"])
    op.create_index("ix_covariate_outlet_outlet_id", "covariate_outlet", ["outlet_id"])
    op.create_index("ix_covariate_outlet_task_id", "covariate_outlet", ["task_id"])


def downgrade() -> None:
    op.drop_table("covariate_outlet")
    op.drop_table("covariates")
