"""Repoint chronos2 'model' params from stale Chronos-T5 checkpoints to Chronos-2.

The ``chronos2`` engine slug maps to ``Chronos2DirectEngine``, which loads **only**
``amazon/chronos-2``. Its ``model`` parameter catalog was carried over from gorm.ai's
old T5-based Chronos and offered chronos-t5-tiny/…/large — none of which the Chronos-2
pipeline can load, so every run silently fell back to the built-in ``statistical``
engine (now surfaced as a ``degraded`` simulation). Replace those options with a single
``chronos-2`` option, in both the engine catalog and every kline_strategy on this engine.

Revision ID: 20260706_120000
Revises: 20260705_120000
Create Date: 2026-07-04
"""

import sqlalchemy as sa
from alembic import op

revision = "20260706_120000"
down_revision = "20260705_120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1) Engine catalog: drop the stale Chronos-T5 'model' options, insert chronos-2.
    conn.execute(
        sa.text(
            "DELETE FROM prediction_engine_parameter WHERE name = 'model' "
            "AND prediction_engine_id = "
            "(SELECT id FROM prediction_engine WHERE slug = 'chronos2')"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO prediction_engine_parameter "
            "(id, prediction_engine_id, name, value, selected, description, "
            " sort_order, parameter, active) "
            "SELECT gen_random_uuid(), id, 'model', 'chronos-2', true, "
            "'Amazon Chronos-2 foundation model', 1, 'amazon/chronos-2', true "
            "FROM prediction_engine WHERE slug = 'chronos2'"
        )
    )

    # 2) Existing kline strategies on this engine: replace their 'model' options too.
    conn.execute(
        sa.text(
            "DELETE FROM kline_strategy_parameter WHERE name = 'model' "
            "AND strategy_id IN "
            "(SELECT id FROM kline_strategy WHERE forecast_engine = 'chronos2')"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO kline_strategy_parameter "
            "(id, strategy_id, name, value, selected, active) "
            "SELECT gen_random_uuid(), id, 'model', 'chronos-2', true, true "
            "FROM kline_strategy WHERE forecast_engine = 'chronos2'"
        )
    )


def downgrade() -> None:
    # The original per-strategy T5 selections are not recoverable; no-op downgrade.
    pass
