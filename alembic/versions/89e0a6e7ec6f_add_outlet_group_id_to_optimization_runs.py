"""Add outlet_group_id to optimization_runs

Revision ID: 89e0a6e7ec6f
Revises: c3d4e5f6a7b8
Create Date: 2026-04-02 10:34:44.894414

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '89e0a6e7ec6f'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "optimization_runs",
        sa.Column("outlet_group_id", sa.dialects.postgresql.UUID(as_uuid=False), nullable=True),
    )
    op.create_foreign_key(
        "fk_optimization_runs_outlet_group_id",
        "optimization_runs",
        "outlet_group",
        ["outlet_group_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_optimization_runs_outlet_group_id", "optimization_runs", type_="foreignkey")
    op.drop_column("optimization_runs", "outlet_group_id")
