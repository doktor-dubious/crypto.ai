"""add model_name to token_llm

Revision ID: 2026051501
Revises: c1e2f3a4b5c6
Create Date: 2026-05-15

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2026051501"
down_revision: Union[str, None] = "c1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "token_llm",
        sa.Column("model_name", sa.String(length=100), nullable=True),
    )
    op.create_index(
        op.f("ix_token_llm_model_name"),
        "token_llm",
        ["model_name"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_token_llm_model_name"), table_name="token_llm")
    op.drop_column("token_llm", "model_name")
