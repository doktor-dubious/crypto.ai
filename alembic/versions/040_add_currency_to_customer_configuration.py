"""Add currency_id to customer_configuration.

Revision ID: 040
Revises: 039
Create Date: 2026-03-10

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "040"
down_revision: Union[str, None] = "039"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "customer_configuration",
        sa.Column(
            "currency_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("currency.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_customer_configuration_currency_id",
        "customer_configuration",
        ["currency_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_customer_configuration_currency_id", table_name="customer_configuration")
    op.drop_column("customer_configuration", "currency_id")
