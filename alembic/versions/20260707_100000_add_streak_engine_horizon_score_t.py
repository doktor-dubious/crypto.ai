"""Streak-reversal baseline engine + forecast horizon + significance score.

1. Seed the 'streak-reversal' engine in the ai-models catalog: a parameter-free
   mean-reversion baseline every foundation model should have to beat.
2. kline_strategy.horizon: bars per forecast step (1 = next-bar walk-forward;
   H>1 scores non-overlapping H-bar trend moves).
3. kline_simulation.score_t: significance (t-statistic) of the run's score,
   sortable on the master table to screen many runs for statistically real edge.

Revision ID: 20260707_100000
Revises: 20260706_120000
Create Date: 2026-07-07
"""

import sqlalchemy as sa
from alembic import op

revision = "20260707_100000"
down_revision = "20260706_120000"
branch_labels = None
depends_on = None

_ENGINE = {
    "slug": "streak-reversal",
    "name": "Streak Reversal",
    "description": (
        "Parameter-free mean-reversion baseline: forecasts the next bar from the "
        "empirical distribution of moves that followed the same up/down streak "
        "state in the context window. The floor every AI model should beat."
    ),
}

_INSERT_ENGINE = sa.text(
    "INSERT INTO prediction_engine (id, slug, name, description, active) "
    "SELECT gen_random_uuid(), CAST(:slug AS varchar), CAST(:name AS varchar), CAST(:description AS text), true "
    "WHERE NOT EXISTS (SELECT 1 FROM prediction_engine WHERE slug = CAST(:slug AS varchar))"
)


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(_INSERT_ENGINE, _ENGINE)

    op.add_column(
        "kline_strategy",
        sa.Column("horizon", sa.Integer(), nullable=False, server_default="1"),
    )

    op.add_column("kline_simulation", sa.Column("score_t", sa.Float(), nullable=True))
    op.create_index("ix_kline_simulation_score_t", "kline_simulation", ["score_t"])
    # Backfill from already-persisted result JSON where the per-run score exists:
    # recompute t = r * sqrt((n-2)/(1-r^2)) from the stored score and test count.
    conn.execute(sa.text(
        """
        UPDATE kline_simulation
        SET score_t = score * sqrt(((result->>'test_points')::float - 2)
                                   / (1 - score ^ 2))
        WHERE score IS NOT NULL
          AND abs(score) < 1
          AND result IS NOT NULL
          AND (result->>'test_points') IS NOT NULL
          AND (result->>'test_points')::float > 2
        """
    ))


def downgrade() -> None:
    conn = op.get_bind()
    op.drop_index("ix_kline_simulation_score_t", table_name="kline_simulation")
    op.drop_column("kline_simulation", "score_t")
    op.drop_column("kline_strategy", "horizon")
    conn.execute(sa.text("DELETE FROM prediction_engine WHERE slug = 'streak-reversal'"))
