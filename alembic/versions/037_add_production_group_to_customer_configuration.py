"""Add production_group_id to customer_configuration.

Revision ID: 037
Revises: 036
Create Date: 2026-03-10

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "037"
down_revision: Union[str, None] = "036"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "customer_configuration",
        sa.Column(
            "production_group_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("outlet_group.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_customer_configuration_production_group_id",
        "customer_configuration",
        ["production_group_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_customer_configuration_production_group_id", table_name="customer_configuration")
    op.drop_column("customer_configuration", "production_group_id")
