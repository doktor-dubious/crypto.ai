"""Add prediction_engine_parameter table with seed data.

Revision ID: 066
Revises: 065
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "066"
down_revision = "065"
branch_labels = None
depends_on = None

ENGINE_ID = "8d559592-35e9-469e-bc1d-c9e99bf999b9"


def upgrade() -> None:
    op.create_table(
        "prediction_engine_parameter",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column(
            "prediction_engine_id",
            UUID(as_uuid=False),
            sa.ForeignKey("prediction_engine.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("value", sa.String(255), nullable=False),
        sa.UniqueConstraint("prediction_engine_id", "name", "value", name="uq_engine_param_name_value"),
    )

    # Seed parameters for engine 8d559592-35e9-469e-bc1d-c9e99bf999b9
    params = op.get_bind()
    table = sa.table(
        "prediction_engine_parameter",
        sa.column("prediction_engine_id", UUID(as_uuid=False)),
        sa.column("name", sa.String),
        sa.column("value", sa.String),
    )

    rows = []
    # submodel
    for v in ("chronos-t5-base", "chronos-t5-small"):
        rows.append({"prediction_engine_id": ENGINE_ID, "name": "submodel", "value": v})
    # samples
    for v in range(100, 0, -10):
        rows.append({"prediction_engine_id": ENGINE_ID, "name": "samples", "value": str(v)})
    # batch_size
    for v in (32, 16, 8):
        rows.append({"prediction_engine_id": ENGINE_ID, "name": "batch_size", "value": str(v)})
    # precision
    for v in ("float32", "bfloat16"):
        rows.append({"prediction_engine_id": ENGINE_ID, "name": "precision", "value": v})

    params.execute(table.insert(), rows)


def downgrade() -> None:
    op.drop_table("prediction_engine_parameter")
