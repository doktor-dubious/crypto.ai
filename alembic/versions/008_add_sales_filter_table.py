"""Add sales_filters table for excluding date ranges from predictions.

Revision ID: 008
Revises: 007
Create Date: 2026-03-04 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOTE: This table is also created in migration 044 with proper defaults.
    # Skipping this migration to avoid duplicate table creation error.
    pass


def downgrade() -> None:
    op.drop_index("ix_sales_filters_customer_id", table_name="sales_filters")
    op.drop_table("sales_filters")
