"""Fix group_id FK on customer_configuration to point to outlet_group (not outlet_groups).

Migration 029 accidentally referenced a non-existent outlet_groups table. This migration
drops the incorrect FK and orphan table, then adds the correct FK to outlet_group.

Revision ID: 030
Revises: 029
Create Date: 2026-03-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the incorrect FK and index added by migration 029
    op.drop_index("ix_customer_configuration_group_id", table_name="customer_configuration")
    op.drop_constraint("fk_customer_configuration_group_id", "customer_configuration", type_="foreignkey")

    # Drop the orphan outlet_groups table created by mistake in migration 029
    op.execute("DROP TABLE IF EXISTS outlet_groups CASCADE")

    # Add the correct FK pointing to the real outlet_group table
    op.create_foreign_key(
        "fk_customer_configuration_group_id",
        "customer_configuration",
        "outlet_group",
        ["group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_customer_configuration_group_id",
        "customer_configuration",
        ["group_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_customer_configuration_group_id", table_name="customer_configuration")
    op.drop_constraint("fk_customer_configuration_group_id", "customer_configuration", type_="foreignkey")
