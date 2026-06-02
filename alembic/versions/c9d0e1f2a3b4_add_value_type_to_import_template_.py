"""Add value_type column to import_template_elements

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-04-18 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "import_template_elements",
        sa.Column(
            "value_type",
            sa.String(length=16),
            nullable=False,
            server_default="string",
        ),
    )


def downgrade() -> None:
    op.drop_column("import_template_elements", "value_type")
