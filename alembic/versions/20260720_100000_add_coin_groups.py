"""coin_group + coin_group_member: named collections of coins.

Adds arbitrary coin groups plus a membership join, and seeds the reserved
``favorites`` system group that backs the heart/favorites UI on the coins page.

Revision ID: 20260720_100000
Revises: 20260719_100000
Create Date: 2026-07-08
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260720_100000"
down_revision = "20260719_100000"
branch_labels = None
depends_on = None


def _base_columns() -> list[sa.Column]:
    return [
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "coin_group",
        *_base_columns(),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("slug", sa.String(length=50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_coin_group_slug"),
    )
    op.create_index("ix_coin_group_active", "coin_group", ["active"])

    op.create_table(
        "coin_group_member",
        *_base_columns(),
        sa.Column("coin_group_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("coin_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["coin_group_id"], ["coin_group.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["coin_id"], ["coin.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("coin_group_id", "coin_id", name="uq_coin_group_member"),
    )
    op.create_index("ix_coin_group_member_active", "coin_group_member", ["active"])
    op.create_index("ix_coin_group_member_coin_group_id", "coin_group_member", ["coin_group_id"])
    op.create_index("ix_coin_group_member_coin_id", "coin_group_member", ["coin_id"])

    # Seed the reserved favorites group.
    op.execute(
        "INSERT INTO coin_group (name, slug) VALUES ('Favorites', 'favorites')"
    )


def downgrade() -> None:
    op.drop_index("ix_coin_group_member_coin_id", table_name="coin_group_member")
    op.drop_index("ix_coin_group_member_coin_group_id", table_name="coin_group_member")
    op.drop_index("ix_coin_group_member_active", table_name="coin_group_member")
    op.drop_table("coin_group_member")
    op.drop_index("ix_coin_group_active", table_name="coin_group")
    op.drop_table("coin_group")
