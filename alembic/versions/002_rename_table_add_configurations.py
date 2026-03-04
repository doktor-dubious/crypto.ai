"""Rename outlet_groups to outlet_group and add configuration tables.

Revision ID: 002
Revises: 001
Create Date: 2026-03-03 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename outlet_groups table to outlet_group (singular)
    op.rename_table("outlet_groups", "outlet_group")

    # 2. Rename indexes for outlet_group table
    op.execute("ALTER INDEX ix_outlet_groups_active RENAME TO ix_outlet_group_active")
    op.execute("ALTER INDEX ix_outlet_groups_customer_id RENAME TO ix_outlet_group_customer_id")
    op.execute("ALTER INDEX ix_outlet_groups_name RENAME TO ix_outlet_group_name")

    # 3. Create configuration table (singleton)
    op.create_table(
        "configuration",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("active", sa.Boolean(), nullable=False, default=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("peak_period", sa.Boolean(), nullable=False, default=True),
        sa.Column("minimum_delivery", sa.Integer(), nullable=False, default=1),
    )
    op.create_index("ix_configuration_active", "configuration", ["active"])

    # 4. Seed singleton configuration row
    op.execute(
        """
        INSERT INTO configuration (id, active, created_at, updated_at, peak_period, minimum_delivery)
        VALUES ('00000000-0000-0000-0000-000000000001', true, NOW(), NOW(), true, 1)
        """
    )

    # 5. Create customer_configuration table
    op.create_table(
        "customer_configuration",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("active", sa.Boolean(), nullable=False, default=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "customer_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("peak_period", sa.Boolean(), nullable=True),
        sa.Column("minimum_delivery", sa.Integer(), nullable=True),
        sa.Column("cost_per_unit", sa.Numeric(10, 2), nullable=True),
        sa.Column("profit_per_unit", sa.Numeric(10, 2), nullable=True),
        sa.UniqueConstraint("customer_id", name="uq_customer_configuration_customer_id"),
    )
    op.create_index("ix_customer_configuration_active", "customer_configuration", ["active"])
    op.create_index(
        "ix_customer_configuration_customer_id", "customer_configuration", ["customer_id"]
    )

    # 6. Create draw_adjustment table
    op.create_table(
        "draw_adjustment",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("active", sa.Boolean(), nullable=False, default=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("outlet_group.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("day_of_week", sa.SmallInteger(), nullable=False),
        sa.Column("type", sa.SmallInteger(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
    )
    op.create_index("ix_draw_adjustment_active", "draw_adjustment", ["active"])
    op.create_index("ix_draw_adjustment_group_id", "draw_adjustment", ["group_id"])


def downgrade() -> None:
    # Drop new tables
    op.drop_table("draw_adjustment")
    op.drop_table("customer_configuration")
    op.drop_table("configuration")

    # Rename outlet_group back to outlet_groups
    op.execute("ALTER INDEX ix_outlet_group_active RENAME TO ix_outlet_groups_active")
    op.execute("ALTER INDEX ix_outlet_group_customer_id RENAME TO ix_outlet_groups_customer_id")
    op.execute("ALTER INDEX ix_outlet_group_name RENAME TO ix_outlet_groups_name")

    op.rename_table("outlet_group", "outlet_groups")
