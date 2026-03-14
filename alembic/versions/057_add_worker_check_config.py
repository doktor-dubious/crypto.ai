"""Add periodic_check_workers and auto_restart_workers to configuration.

Revision ID: 057
Revises: 056
Create Date: 2026-03-13

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "057"
down_revision: Union[str, None] = "056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("configuration", sa.Column("periodic_check_workers", sa.Integer, nullable=False, server_default="2"))
    op.add_column("configuration", sa.Column("auto_restart_workers", sa.Boolean, nullable=False, server_default="true"))


def downgrade() -> None:
    op.drop_column("configuration", "auto_restart_workers")
    op.drop_column("configuration", "periodic_check_workers")
