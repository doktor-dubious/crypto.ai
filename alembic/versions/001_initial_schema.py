"""Initial schema with TimescaleDB hypertable.

Revision ID: 001
Revises:
Create Date: 2024-01-01 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable TimescaleDB extension
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")

    # Create customers table
    op.create_table(
        "customers",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("active", sa.Boolean(), nullable=False, default=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("type", sa.SmallInteger(), nullable=False, default=0),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_customers_active", "customers", ["active"])
    op.create_index("ix_customers_name", "customers", ["name"])

    # Create outlets table
    op.create_table(
        "outlets",
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
        sa.Column("ext_id", sa.String(50), nullable=False),
        sa.Column("ext_id_2", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("address", sa.String(255), nullable=True),
        sa.Column("zip", sa.String(20), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("state", sa.String(100), nullable=True),
        sa.Column("country", sa.String(100), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("scan", sa.Boolean(), nullable=False, default=False),
        sa.Column("season", sa.Boolean(), nullable=False, default=False),
        sa.Column("sublets", sa.Boolean(), nullable=False, default=False),
    )
    op.create_index("ix_outlets_active", "outlets", ["active"])
    op.create_index("ix_outlets_customer_id", "outlets", ["customer_id"])
    op.create_index("ix_outlets_ext_id", "outlets", ["ext_id"])
    op.create_index("ix_outlets_ext_id_2", "outlets", ["ext_id_2"])
    op.create_index("ix_outlets_name", "outlets", ["name"])

    # Create outlet_info table
    op.create_table(
        "outlet_info",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("active", sa.Boolean(), nullable=False, default=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "outlet_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("outlets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
    )
    op.create_index("ix_outlet_info_active", "outlet_info", ["active"])
    op.create_index("ix_outlet_info_outlet_id", "outlet_info", ["outlet_id"])
    op.create_index("ix_outlet_info_key", "outlet_info", ["key"])

    # Create outlet_deliveries table
    op.create_table(
        "outlet_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("active", sa.Boolean(), nullable=False, default=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "outlet_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("outlets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("quantity", sa.SmallInteger(), nullable=False, default=0),
    )
    op.create_index("ix_outlet_deliveries_active", "outlet_deliveries", ["active"])
    op.create_index("ix_outlet_deliveries_outlet_id", "outlet_deliveries", ["outlet_id"])

    # Create outlet_groups table
    op.create_table(
        "outlet_groups",
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
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.create_index("ix_outlet_groups_active", "outlet_groups", ["active"])
    op.create_index("ix_outlet_groups_customer_id", "outlet_groups", ["customer_id"])
    op.create_index("ix_outlet_groups_name", "outlet_groups", ["name"])

    # Create outlet_group_members table
    op.create_table(
        "outlet_group_members",
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
            sa.ForeignKey("outlet_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "outlet_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("outlets.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    op.create_index("ix_outlet_group_members_active", "outlet_group_members", ["active"])
    op.create_index("ix_outlet_group_members_group_id", "outlet_group_members", ["group_id"])
    op.create_index("ix_outlet_group_members_outlet_id", "outlet_group_members", ["outlet_id"])

    # Create sales table (will be converted to hypertable)
    # TimescaleDB requires partition column (date) to be part of primary key
    op.create_table(
        "sales",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
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
        sa.Column(
            "outlet_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("outlets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Core prediction field
        sa.Column("sold", sa.Integer(), nullable=False, default=0),
        # Additional analytics fields (nullable)
        sa.Column("delivered", sa.Integer(), nullable=True),
        sa.Column("scan_sold", sa.Integer(), nullable=True),
        sa.Column("net_sold", sa.Integer(), nullable=True),
        # Composite primary key required for TimescaleDB hypertable
        sa.PrimaryKeyConstraint("id", "date"),
    )
    op.create_index("ix_sales_active", "sales", ["active"])
    op.create_index("ix_sales_customer_id", "sales", ["customer_id"])
    op.create_index("ix_sales_outlet_id", "sales", ["outlet_id"])
    op.create_index("ix_sales_date", "sales", ["date"])

    # Convert sales table to TimescaleDB hypertable
    op.execute(
        "SELECT create_hypertable('sales', 'date', chunk_time_interval => INTERVAL '1 month', "
        "migrate_data => true, if_not_exists => true)"
    )


def downgrade() -> None:
    op.drop_table("sales")
    op.drop_table("outlet_group_members")
    op.drop_table("outlet_groups")
    op.drop_table("outlet_deliveries")
    op.drop_table("outlet_info")
    op.drop_table("outlets")
    op.drop_table("customers")
    op.execute("DROP EXTENSION IF EXISTS timescaledb CASCADE")
