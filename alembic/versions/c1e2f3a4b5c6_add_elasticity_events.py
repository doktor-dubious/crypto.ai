"""Add price_change_event and elasticity_event tables

Revision ID: c1e2f3a4b5c6
Revises: b3c5d7e9f1a2
Create Date: 2026-04-27 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "c1e2f3a4b5c6"
down_revision: Union[str, None] = "b3c5d7e9f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "price_change_event",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "customer_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "outlet_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("outlets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("change_date", sa.Date(), nullable=False),
        sa.Column("price_before", sa.Float(), nullable=False),
        sa.Column("price_after", sa.Float(), nullable=False),
        sa.UniqueConstraint(
            "outlet_id", "weekday", "change_date",
            name="uq_price_change_event_outlet_weekday_date",
        ),
    )
    op.create_index(
        "ix_price_change_event_active",
        "price_change_event", ["active"],
    )
    op.create_index(
        "ix_price_change_event_customer_id",
        "price_change_event", ["customer_id"],
    )
    op.create_index(
        "ix_price_change_event_outlet_id",
        "price_change_event", ["outlet_id"],
    )
    op.create_index(
        "ix_price_change_event_change_date",
        "price_change_event", ["change_date"],
    )

    op.create_table(
        "elasticity_event",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "price_change_event_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("price_change_event.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "outlet_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("outlets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("engine", sa.String(64), nullable=False),
        sa.Column("post_days", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.String(64), nullable=True),
        sa.Column("forecast_mean", sa.Float(), nullable=True),
        sa.Column("actual_mean", sa.Float(), nullable=True),
        sa.Column("n_post_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("epsilon", sa.Float(), nullable=True),
        sa.Column(
            "confidence",
            sa.String(32),
            nullable=False,
            server_default="insufficient",
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "price_change_event_id", "engine", "post_days",
            name="uq_elasticity_event_event_engine_post",
        ),
    )
    op.create_index(
        "ix_elasticity_event_active",
        "elasticity_event", ["active"],
    )
    op.create_index(
        "ix_elasticity_event_price_change_event_id",
        "elasticity_event", ["price_change_event_id"],
    )
    op.create_index(
        "ix_elasticity_event_outlet_id",
        "elasticity_event", ["outlet_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_elasticity_event_outlet_id", table_name="elasticity_event")
    op.drop_index(
        "ix_elasticity_event_price_change_event_id", table_name="elasticity_event"
    )
    op.drop_index("ix_elasticity_event_active", table_name="elasticity_event")
    op.drop_table("elasticity_event")

    op.drop_index(
        "ix_price_change_event_change_date", table_name="price_change_event"
    )
    op.drop_index(
        "ix_price_change_event_outlet_id", table_name="price_change_event"
    )
    op.drop_index(
        "ix_price_change_event_customer_id", table_name="price_change_event"
    )
    op.drop_index("ix_price_change_event_active", table_name="price_change_event")
    op.drop_table("price_change_event")
