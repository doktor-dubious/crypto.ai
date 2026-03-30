"""Add prediction_engine_id to optimization_runs.

Revision ID: 096
Revises: 095
Create Date: 2026-03-29

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "096"
down_revision: Union[str, None] = "095"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "optimization_runs",
        sa.Column(
            "prediction_engine_id",
            sa.UUID(as_uuid=False),
            sa.ForeignKey("prediction_engine.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("optimization_runs", "prediction_engine_id")
