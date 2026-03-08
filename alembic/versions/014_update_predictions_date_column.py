"""Replace prediction_from/prediction_to with single date column on predictions.

Revision ID: 014
Revises: 013
Create Date: 2026-03-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("predictions", "prediction_from")
    op.drop_column("predictions", "prediction_to")
    op.add_column("predictions", sa.Column("date", sa.Date(), nullable=False, server_default="now()"))
    # Remove the server_default after adding — it was only needed to satisfy NOT NULL for existing rows
    op.alter_column("predictions", "date", server_default=None)


def downgrade() -> None:
    op.drop_column("predictions", "date")
    op.add_column("predictions", sa.Column("prediction_from", sa.Date(), nullable=False, server_default="now()"))
    op.add_column("predictions", sa.Column("prediction_to", sa.Date(), nullable=False, server_default="now()"))
    op.alter_column("predictions", "prediction_from", server_default=None)
    op.alter_column("predictions", "prediction_to", server_default=None)
