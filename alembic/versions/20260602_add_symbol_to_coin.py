"""Add symbol column to coin table

Revision ID: 20260602_174500
Revises: 20260602_163700
Create Date: 2026-06-02 17:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260602_174500"
down_revision: Union[str, None] = "20260602_163700"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add column as nullable first to handle existing rows
    op.add_column(
        "coin",
        sa.Column("symbol", sa.String(), nullable=True, index=True),
    )

    # Update existing coins with symbol based on their name
    # Known coins get their standard symbols, others get generated
    op.execute(
        """
        UPDATE coin
        SET symbol =
            CASE
                WHEN name = 'Bitcoin' THEN 'BTC'
                WHEN name = 'Ethereum' THEN 'ETH'
                WHEN name = 'Tether' THEN 'USDT'
                WHEN name = 'Cardano' THEN 'ADA'
                ELSE UPPER(LEFT(name, 1)) || UPPER(SUBSTRING(name, 2, 2))
            END
        WHERE symbol IS NULL
        """
    )

    # Make it not nullable
    op.alter_column("coin", "symbol", nullable=False)


def downgrade() -> None:
    op.drop_column("coin", "symbol")
