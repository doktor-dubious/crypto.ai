"""Add composite index on sales(customer_id, outlet_id, date).

The bulk sales query used during prediction fetches all sales for a customer
filtered by a list of outlet_ids and a date range. The existing single-column
indexes force Postgres to use a bitmap AND across three separate index scans,
which is extremely slow at millions of rows / 4000+ outlets. A composite index
covering (customer_id, outlet_id, date) satisfies the full WHERE clause in a
single index scan and also covers the ORDER BY outlet_id, date clause.

Revision ID: 028
Revises: 027
Create Date: 2026-03-08
"""

from typing import Sequence, Union

from alembic import op

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Composite index for the bulk prediction query:
    # WHERE customer_id = X AND outlet_id IN (...) AND date <= Y AND active = true
    # ORDER BY outlet_id, date
    op.create_index(
        "ix_sales_customer_outlet_date",
        "sales",
        ["customer_id", "outlet_id", "date"],
    )


def downgrade() -> None:
    op.drop_index("ix_sales_customer_outlet_date", table_name="sales")
