"""Backfill last_prediction from prediction_outlets history.

For each (outlet_id, weekday) pair takes the most recent prediction_outlet row
and upserts it into last_prediction.  Covers all historical predictions that
predate the creation of the last_prediction table (migration 046).

Revision ID: 053
Revises: 052
Create Date: 2026-03-12

"""

from typing import Union

from alembic import op

revision: str = "053"
down_revision: Union[str, None] = "052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        WITH latest AS (
            SELECT DISTINCT ON (po.outlet_id, EXTRACT(isodow FROM p.date)::int)
                po.outlet_id,
                po.prediction_id,
                EXTRACT(isodow FROM p.date)::smallint AS weekday,
                po.predicted,
                po.eo            AS economic_optimal,
                po.delivered,
                po.lower_bound,
                po.upper_bound,
                po.fixed,
                po.minimum,
                po.maximum,
                po."add",
                po.add_pct,
                CASE EXTRACT(isodow FROM p.date)::int
                    WHEN 1 THEN po.correction_mon
                    WHEN 2 THEN po.correction_tue
                    WHEN 3 THEN po.correction_wed
                    WHEN 4 THEN po.correction_thu
                    WHEN 5 THEN po.correction_fri
                    WHEN 6 THEN po.correction_sat
                    WHEN 7 THEN po.correction_sun
                END AS weekday_correction
            FROM prediction_outlets po
            JOIN predictions p ON p.id = po.prediction_id
            WHERE po.active = true AND p.active = true
            ORDER BY po.outlet_id, EXTRACT(isodow FROM p.date)::int, p.date DESC
        )
        INSERT INTO last_prediction (
            id, outlet_id, prediction_id, weekday,
            predicted, economic_optimal, delivered,
            lower_bound, upper_bound,
            fixed, minimum, maximum, "add", add_pct,
            weekday_correction
        )
        SELECT
            gen_random_uuid(),
            outlet_id, prediction_id, weekday,
            predicted, economic_optimal, delivered,
            lower_bound, upper_bound,
            fixed, minimum, maximum, "add", add_pct,
            weekday_correction
        FROM latest
        ON CONFLICT (outlet_id, weekday) DO UPDATE SET
            prediction_id      = EXCLUDED.prediction_id,
            predicted          = EXCLUDED.predicted,
            economic_optimal   = EXCLUDED.economic_optimal,
            delivered          = EXCLUDED.delivered,
            lower_bound        = EXCLUDED.lower_bound,
            upper_bound        = EXCLUDED.upper_bound,
            fixed              = EXCLUDED.fixed,
            minimum            = EXCLUDED.minimum,
            maximum            = EXCLUDED.maximum,
            "add"              = EXCLUDED."add",
            add_pct            = EXCLUDED.add_pct,
            weekday_correction = EXCLUDED.weekday_correction
    """)


def downgrade() -> None:
    # Backfill is safe to leave; truncating would destroy legitimate data
    pass
