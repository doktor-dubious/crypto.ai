"""Rename autogluon engine slugs.

autogluon   → gluon-chronos-bolt
chronos2    → gluon-chronos2

Revision ID: 035
Revises: 034
Create Date: 2026-03-09

"""

from typing import Sequence, Union

from alembic import op

revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE prediction_engine SET slug = 'gluon-chronos-bolt', updated_at = NOW() WHERE slug = 'autogluon'")
    op.execute("UPDATE prediction_engine SET slug = 'gluon-chronos2', updated_at = NOW() WHERE slug = 'chronos2'")


def downgrade() -> None:
    op.execute("UPDATE prediction_engine SET slug = 'autogluon', updated_at = NOW() WHERE slug = 'gluon-chronos-bolt'")
    op.execute("UPDATE prediction_engine SET slug = 'chronos2', updated_at = NOW() WHERE slug = 'gluon-chronos2'")
