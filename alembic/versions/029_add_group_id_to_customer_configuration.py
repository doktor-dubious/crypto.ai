"""Add group_id FK to customer_configuration.

Also ensures outlet_groups and outlet_group_members exist, as they may be
absent on databases that were initialised before migration 001 included them.

Revision ID: 029
Revises: 028
Create Date: 2026-03-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create outlet_groups if missing (may not exist on older databases)
    op.execute("""
        CREATE TABLE IF NOT EXISTS outlet_groups (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            active      BOOLEAN NOT NULL DEFAULT true,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
            name        VARCHAR(255) NOT NULL,
            description TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_outlet_groups_active      ON outlet_groups (active)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_outlet_groups_customer_id ON outlet_groups (customer_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_outlet_groups_name        ON outlet_groups (name)")

    # Create outlet_group_members if missing
    op.execute("""
        CREATE TABLE IF NOT EXISTS outlet_group_members (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            active     BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            group_id   UUID NOT NULL REFERENCES outlet_groups(id) ON DELETE CASCADE,
            outlet_id  UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_outlet_group_members_active     ON outlet_group_members (active)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_outlet_group_members_group_id   ON outlet_group_members (group_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_outlet_group_members_outlet_id  ON outlet_group_members (outlet_id)")

    # Add group_id to customer_configuration
    op.add_column(
        "customer_configuration",
        sa.Column("group_id", postgresql.UUID(as_uuid=False), nullable=True),
    )
    op.create_foreign_key(
        "fk_customer_configuration_group_id",
        "customer_configuration",
        "outlet_groups",
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
    op.drop_column("customer_configuration", "group_id")
