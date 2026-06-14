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

# These parameters belong to the AutoGluon Chronos-2 engine (chronos-t5
# submodels, bfloat16 default precision). Resolve its id by slug at runtime
# instead of hardcoding a UUID — engine rows are seeded with deterministic ids
# that differ from the author's original dev database. Note the slug was
# renamed from "chronos2" to "gluon-chronos2" in migration 035, which runs
# before this one.
ENGINE_SLUG = "gluon-chronos2"


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

    # Resolve the target engine id by slug. If the engine is not present
    # (e.g. partial seed), skip seeding rather than violating the FK.
    conn = op.get_bind()
    engine_id = conn.execute(
        sa.text("SELECT id FROM prediction_engine WHERE slug = :slug"),
        {"slug": ENGINE_SLUG},
    ).scalar()
    if engine_id is None:
        return

    table = sa.table(
        "prediction_engine_parameter",
        sa.column("prediction_engine_id", UUID(as_uuid=False)),
        sa.column("name", sa.String),
        sa.column("value", sa.String),
    )

    rows = []
    # submodel
    for v in ("chronos-t5-base", "chronos-t5-small"):
        rows.append({"prediction_engine_id": engine_id, "name": "submodel", "value": v})
    # samples
    for v in range(100, 0, -10):
        rows.append({"prediction_engine_id": engine_id, "name": "samples", "value": str(v)})
    # batch_size
    for v in (32, 16, 8):
        rows.append({"prediction_engine_id": engine_id, "name": "batch_size", "value": str(v)})
    # precision
    for v in ("float32", "bfloat16"):
        rows.append({"prediction_engine_id": engine_id, "name": "precision", "value": v})

    conn.execute(table.insert(), rows)


def downgrade() -> None:
    op.drop_table("prediction_engine_parameter")
