"""Enable pg_trgm extension for fuzzy entity lookup

Revision ID: b3c5d7e9f1a2
Revises: f2a3b4c5d6e7
Create Date: 2026-04-22 12:05:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b3c5d7e9f1a2'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
