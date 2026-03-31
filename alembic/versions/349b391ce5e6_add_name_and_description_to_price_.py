"""add name and description to price_history

Revision ID: 349b391ce5e6
Revises: 271b9d0b651f
Create Date: 2026-03-31 12:09:20.161697

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '349b391ce5e6'
down_revision: Union[str, None] = '271b9d0b651f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('price_history', sa.Column('name', sa.Text(), nullable=False, server_default=''))
    op.add_column('price_history', sa.Column('description', sa.Text(), nullable=True))
    op.alter_column('price_history', 'name', server_default=None)


def downgrade() -> None:
    op.drop_column('price_history', 'description')
    op.drop_column('price_history', 'name')
