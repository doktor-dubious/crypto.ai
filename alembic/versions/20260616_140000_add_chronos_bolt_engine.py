"""Add Chronos Bolt engine to the ai-models catalog (copied from gorm.ai).

Revision ID: 20260616_140000
Revises: 20260616_130000
Create Date: 2026-06-16
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "20260616_140000"
down_revision = "20260616_130000"
branch_labels = None
depends_on = None

_ENGINE = {"slug": "chronos-bolt", "name": "Chronos Bolt", "description": "Chronos Bolt without AutoGluon"}
_PARAMS = json.loads('[{"slug": "chronos-bolt", "name": "precision", "value": "bfloat16", "selected": true, "description": null, "sort_order": 0, "parameter": null}, {"slug": "chronos-bolt", "name": "precision", "value": "float16", "selected": false, "description": null, "sort_order": 0, "parameter": null}, {"slug": "chronos-bolt", "name": "precision", "value": "float32", "selected": false, "description": null, "sort_order": 0, "parameter": null}, {"slug": "chronos-bolt", "name": "batch_size", "value": "16", "selected": false, "description": null, "sort_order": 0, "parameter": null}, {"slug": "chronos-bolt", "name": "batch_size", "value": "8", "selected": true, "description": null, "sort_order": 0, "parameter": null}, {"slug": "chronos-bolt", "name": "batch_size", "value": "4", "selected": false, "description": null, "sort_order": 0, "parameter": null}, {"slug": "chronos-bolt", "name": "model", "value": "chronos-bolt-tiny", "selected": false, "description": null, "sort_order": 0, "parameter": null}, {"slug": "chronos-bolt", "name": "model", "value": "chronos-bolt-mini", "selected": false, "description": null, "sort_order": 0, "parameter": null}, {"slug": "chronos-bolt", "name": "model", "value": "chronos-bolt-small", "selected": true, "description": null, "sort_order": 0, "parameter": null}, {"slug": "chronos-bolt", "name": "model", "value": "chronos-bolt-base", "selected": false, "description": null, "sort_order": 0, "parameter": null}]')

_INSERT_ENGINE = sa.text(
    "INSERT INTO prediction_engine (id, slug, name, description, active) "
    "SELECT gen_random_uuid(), CAST(:slug AS varchar), CAST(:name AS varchar), CAST(:description AS text), true "
    "WHERE NOT EXISTS (SELECT 1 FROM prediction_engine WHERE slug = CAST(:slug AS varchar))"
)
_DELETE_PARAMS = sa.text(
    "DELETE FROM prediction_engine_parameter WHERE prediction_strategy_id IS NULL "
    "AND prediction_engine_id = (SELECT id FROM prediction_engine WHERE slug = CAST(:slug AS varchar))"
)
_INSERT_PARAM = sa.text(
    "INSERT INTO prediction_engine_parameter "
    "(id, prediction_engine_id, name, value, selected, description, sort_order, parameter, active) "
    "SELECT gen_random_uuid(), id, CAST(:name AS varchar), CAST(:value AS varchar), CAST(:selected AS boolean), "
    "CAST(:description AS text), CAST(:sort_order AS integer), CAST(:parameter AS varchar), true "
    "FROM prediction_engine WHERE slug = CAST(:slug AS varchar)"
)


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(_INSERT_ENGINE, _ENGINE)
    conn.execute(_DELETE_PARAMS, {"slug": "chronos-bolt"})
    for p in _PARAMS:
        conn.execute(_INSERT_PARAM, p)


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(_DELETE_PARAMS, {"slug": "chronos-bolt"})
    conn.execute(sa.text("DELETE FROM prediction_engine WHERE slug = 'chronos-bolt'"))
