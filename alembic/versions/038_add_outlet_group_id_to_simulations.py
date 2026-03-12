"""Add outlet_group_id to simulations.

Revision ID: 038
Revises: 037
Create Date: 2026-03-10

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "038"
down_revision: Union[str, None] = "037"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "simulations",
        sa.Column(
            "outlet_group_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("outlet_group.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_simulations_outlet_group_id",
        "simulations",
        ["outlet_group_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_simulations_outlet_group_id", table_name="simulations")
    op.drop_column("simulations", "outlet_group_id")
