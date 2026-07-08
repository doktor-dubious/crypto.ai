"""Add FM engines (TTM, TabPFN-TS, Toto 2.0), switch Chronos-2 to the real
amazon/chronos-2 model, and bump FlowState to revision r1.1.

Adds prediction_engine rows for ttm / tabpfn / toto2 and their selectable
parameter options.  Replaces the stale Chronos-2 (v1 chronos-t5-*) parameter
options with the real Chronos-2 model + precision options.  Replaces FlowState's
`revision` options so r1.1 is the selected default (main kept as the original-r1
option).

Revision ID: 20260701_120000
Revises: 20260616_150000
Create Date: 2026-07-01
"""

import sqlalchemy as sa

from alembic import op

revision = "20260701_120000"
down_revision = "20260616_150000"
branch_labels = None
depends_on = None


ADD_ENGINES = [
    {"slug": "ttm", "name": "TinyTimeMixer", "description": "IBM TinyTimeMixer compact forecaster (point + synthetic quantiles)"},
    {"slug": "tabpfn", "name": "TabPFN-TS", "description": "Prior Labs TabPFN-TS (local-only; strong on short/sparse series)"},
    {"slug": "toto2", "name": "Toto 2.0", "description": "Datadog Toto 2.0 foundation model (direct quantile output)"},
]

# Engine-level parameter options to (re)seed.  Each entry:
# (slug, name, value, selected, description, sort_order, parameter)
# `parameter` (when set) is the resolved HuggingFace model id; the prediction
# path prefers it, the simulation path uses `value` (resolved via the engine's
# alias map) — both are wired to agree here.
_PARAMS = [
    # --- Chronos-2 (real amazon/chronos-2) -------------------------------
    ("chronos2", "model", "chronos-2", True, "Amazon Chronos-2 (real v2 model)", 1, "amazon/chronos-2"),
    ("chronos2", "precision", "float32", True, "Safest CPU default", 2, None),
    ("chronos2", "precision", "bfloat16", False, "GPU: ~2x faster, half memory", 2, None),
    ("chronos2", "precision", "float16", False, "Can overflow on large values", 2, None),
    # --- TinyTimeMixer ---------------------------------------------------
    ("ttm", "model", "r1", False, "TTM r1 (~1M params)", 1, "ibm-granite/granite-timeseries-ttm-r1"),
    ("ttm", "model", "r2", True, "TTM r2 (~5M params)", 1, "ibm-granite/granite-timeseries-ttm-r2"),
    ("ttm", "batch_size", "4", False, None, 2, None),
    ("ttm", "batch_size", "8", False, None, 2, None),
    ("ttm", "batch_size", "16", True, None, 2, None),
    ("ttm", "batch_size", "32", False, None, 2, None),
    # --- Toto 2.0 --------------------------------------------------------
    ("toto2", "model", "toto-2.0-4m", False, None, 1, "Datadog/Toto-2.0-4m"),
    ("toto2", "model", "toto-2.0-22m", False, None, 1, "Datadog/Toto-2.0-22m"),
    ("toto2", "model", "toto-2.0-313m", True, "Default 313M checkpoint", 1, "Datadog/Toto-2.0-313m"),
    ("toto2", "model", "toto-2.0-1b", False, None, 1, "Datadog/Toto-2.0-1B"),
    ("toto2", "model", "toto-2.0-2.5b", False, None, 1, "Datadog/Toto-2.0-2.5B"),
    ("toto2", "precision", "float32", True, "Safest; avoids CPU dtype mismatch", 2, None),
    ("toto2", "precision", "bfloat16", False, "GPU only", 2, None),
    ("toto2", "precision", "float16", False, "GPU only", 2, None),
    # --- TabPFN-TS (only batch_size is meaningful) -----------------------
    ("tabpfn", "batch_size", "4", False, None, 1, None),
    ("tabpfn", "batch_size", "8", True, None, 1, None),
    ("tabpfn", "batch_size", "16", False, None, 1, None),
    ("tabpfn", "batch_size", "32", False, None, 1, None),
    # --- FlowState revision bump (r1.1 default) --------------------------
    ("flowstate", "revision", "r1.1", True, "18.5M params, 4096 context (recommended)", 0, None),
    ("flowstate", "revision", "main", False, "Original r1 (9M params, 2048 context)", 0, None),
]

# Slugs whose param NAMES we fully replace before inserting (engine-level rows).
_REPLACE = [
    ("chronos2", "model"), ("chronos2", "precision"), ("chronos2", "samples"), ("chronos2", "batch_size"),
    ("ttm", "model"), ("ttm", "batch_size"),
    ("toto2", "model"), ("toto2", "precision"),
    ("tabpfn", "batch_size"),
    ("flowstate", "revision"),
]

_INSERT_ENGINE = sa.text(
    "INSERT INTO prediction_engine (id, slug, name, description, active) "
    "SELECT gen_random_uuid(), CAST(:slug AS varchar), CAST(:name AS varchar), CAST(:description AS text), true "
    "WHERE NOT EXISTS (SELECT 1 FROM prediction_engine WHERE slug = CAST(:slug AS varchar))"
)
_DELETE_ENGINE = sa.text("DELETE FROM prediction_engine WHERE slug = CAST(:slug AS varchar)")
_DELETE_PARAMS_BY_NAME = sa.text(
    "DELETE FROM prediction_engine_parameter WHERE prediction_strategy_id IS NULL "
    "AND name = CAST(:name AS varchar) "
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
    for e in ADD_ENGINES:
        conn.execute(_INSERT_ENGINE, e)
    for slug, name in _REPLACE:
        conn.execute(_DELETE_PARAMS_BY_NAME, {"slug": slug, "name": name})
    for slug, name, value, selected, description, sort_order, parameter in _PARAMS:
        conn.execute(_INSERT_PARAM, {
            "slug": slug, "name": name, "value": value, "selected": selected,
            "description": description, "sort_order": sort_order, "parameter": parameter,
        })


def downgrade() -> None:
    conn = op.get_bind()
    # Drop the seeded param options for all touched engines.
    for slug, name in _REPLACE:
        conn.execute(_DELETE_PARAMS_BY_NAME, {"slug": slug, "name": name})
    # Remove the new engine rows (chronos2/flowstate rows predate this migration).
    for e in ADD_ENGINES:
        conn.execute(_DELETE_ENGINE, {"slug": e["slug"]})
