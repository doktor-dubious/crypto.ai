"""Add prediction_engine table and FK columns on configuration tables.

Revision ID: 003
Revises: 002
Create Date: 2026-03-04 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create prediction_engine table
    op.create_table(
        "prediction_engine",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("active", sa.Boolean(), nullable=False, default=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("slug", sa.String(50), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.UniqueConstraint("slug", name="uq_prediction_engine_slug"),
    )
    op.create_index("ix_prediction_engine_active", "prediction_engine", ["active"])
    op.create_index("ix_prediction_engine_slug", "prediction_engine", ["slug"])

    # 2. Seed built-in engines
    op.execute(
        """
        INSERT INTO prediction_engine (id, active, created_at, updated_at, slug, name, description)
        VALUES
            ('00000000-0000-0000-0000-000000000010', true, NOW(), NOW(),
             'statistical', 'Statistical', 'Classical statistical forecasting model'),
            ('00000000-0000-0000-0000-000000000011', true, NOW(), NOW(),
             'timesfm', 'TimesFM', 'Google TimesFM foundation model for time series forecasting'),
            ('00000000-0000-0000-0000-000000000012', true, NOW(), NOW(),
             'custom', 'Custom', 'Custom prediction engine implementation')
        """
    )

    # 3. Add prediction_engine_id FK to configuration
    op.add_column(
        "configuration",
        sa.Column(
            "prediction_engine_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("prediction_engine.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_configuration_prediction_engine_id", "configuration", ["prediction_engine_id"]
    )

    # 4. Add prediction_engine_id FK to customer_configuration
    op.add_column(
        "customer_configuration",
        sa.Column(
            "prediction_engine_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("prediction_engine.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_customer_configuration_prediction_engine_id",
        "customer_configuration",
        ["prediction_engine_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_customer_configuration_prediction_engine_id", "customer_configuration")
    op.drop_column("customer_configuration", "prediction_engine_id")

    op.drop_index("ix_configuration_prediction_engine_id", "configuration")
    op.drop_column("configuration", "prediction_engine_id")

    op.drop_table("prediction_engine")
