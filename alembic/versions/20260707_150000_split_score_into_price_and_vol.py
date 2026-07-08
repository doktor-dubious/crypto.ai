"""Split the run score into separate price and volatility columns.

`score`/`score_t` previously held a target-aware value: the vol-forecast
correlation for forecast_vol runs, the return IC otherwise. Two different,
incomparable metrics in one sortable column. Now:
  - score / score_t         = directional return IC (+ its t) — every run
  - score_vol / score_vol_t = vol-forecast corr (+ its t) — vol runs only

Backfills all four from each run's stored result JSON (best model wins),
recomputing missing t-statistics from the correlation and sample count.

Revision ID: 20260707_150000
Revises: 20260707_100000
Create Date: 2026-07-05
"""

import json
import math

import sqlalchemy as sa
from alembic import op

revision = "20260707_150000"
down_revision = "20260707_100000"
branch_labels = None
depends_on = None


def _t_stat(r, n):
    if r is None or n is None or n < 3 or not (-1.0 < r < 1.0):
        return None
    return r * math.sqrt((n - 2) / (1.0 - r * r))


def _best(values):
    vals = [v for v in values if isinstance(v, (int, float))]
    return max(vals) if vals else None


def upgrade() -> None:
    op.add_column("kline_simulation", sa.Column("score_vol", sa.Float(), nullable=True))
    op.add_column("kline_simulation", sa.Column("score_vol_t", sa.Float(), nullable=True))
    op.create_index("ix_kline_simulation_score_vol", "kline_simulation", ["score_vol"])
    op.create_index("ix_kline_simulation_score_vol_t", "kline_simulation", ["score_vol_t"])

    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, result FROM kline_simulation WHERE result IS NOT NULL"
    )).fetchall()
    for rid, result in rows:
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except ValueError:
                continue
        models = result.get("models") if isinstance(result, dict) else None
        if not isinstance(models, dict):
            continue
        ics, ic_ts, corrs, corr_ts = [], [], [], []
        for m in models.values():
            if not isinstance(m, dict):
                continue
            metrics = m.get("metrics") or {}
            ic = metrics.get("return_ic")
            n = metrics.get("test_count") or m.get("test_count")
            ics.append(ic)
            ic_ts.append(metrics.get("return_ic_t") or _t_stat(ic, n))
            vm = m.get("vol_metrics") or {}
            corrs.append(vm.get("corr"))
            corr_ts.append(vm.get("corr_t") or _t_stat(vm.get("corr"), vm.get("count")))
        conn.execute(
            sa.text(
                "UPDATE kline_simulation SET score = :s, score_t = :st, "
                "score_vol = :sv, score_vol_t = :svt WHERE id = :id"
            ),
            {
                "id": rid,
                "s": _best(ics),
                "st": _best(ic_ts),
                "sv": _best(corrs),
                "svt": _best(corr_ts),
            },
        )


def downgrade() -> None:
    # Restore the old target-aware semantics: vol runs rank by their vol corr.
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE kline_simulation SET score = score_vol, score_t = score_vol_t "
        "WHERE score_vol IS NOT NULL"
    ))
    op.drop_index("ix_kline_simulation_score_vol_t", table_name="kline_simulation")
    op.drop_index("ix_kline_simulation_score_vol", table_name="kline_simulation")
    op.drop_column("kline_simulation", "score_vol_t")
    op.drop_column("kline_simulation", "score_vol")
