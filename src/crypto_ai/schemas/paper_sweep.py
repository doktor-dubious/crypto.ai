"""Schemas for paper-trade sweeps (rotating strategy×coin searches)."""

from datetime import datetime

from pydantic import BaseModel


class SweepStatus(BaseModel):
    """One sweep's config plus queue progress."""

    id: str
    name: str
    enabled: bool
    max_concurrent: int
    dwell_days: float
    initial_capital: float
    n_templates: int
    n_coins: int
    n_combos_total: int
    n_combos_tried: int
    n_running: int


class SweepTemplateCoin(BaseModel):
    """One coin's run under a template — the runs-cell tooltip/dialog breakdown."""

    symbol: str
    status: str
    pnl_pct: float
    n_trades: int


class SweepTemplateStat(BaseModel):
    """One template's results pooled across every coin it has run on."""

    template_id: str
    template_name: str
    strategy: str
    n_runs: int
    n_running: int
    avg_pnl_pct: float
    median_pnl_pct: float
    win_rate_pct: float  # share of runs with positive P/L
    total_trades: int
    total_pnl_quote: float
    # Per-coin breakdown, best first (multiple runs on one coin appear once each).
    coins: list[SweepTemplateCoin] = []


class SweepRunStat(BaseModel):
    """One individual template×coin run, for the best/worst lists."""

    run_id: str
    template_id: str
    template_name: str
    strategy: str
    coin_symbol: str
    interval: str
    status: str
    started_at: datetime
    days: float
    pnl_pct: float
    n_trades: int


class SweepPairStat(BaseModel):
    """An A/B pair: two templates identical except for the higher-timeframe gate.

    Because the combo queue is coin-major, both members of a pair start on the
    same coin in the same rotation wave — so their runs can be matched into
    genuine PAIRS and read with a paired t-test, which is far more powerful
    than comparing the two pooled averages (it differences out the coin and the
    period, which dominate the variance).
    """

    base_template_id: str
    base_template_name: str
    variant_template_id: str
    variant_template_name: str
    strategy: str
    # The gate under test, e.g. "align 4h (0.5σ)".
    variant_gate: str
    n_paired: int  # coins where BOTH members have a comparable run
    base_avg_pnl_pct: float
    variant_avg_pnl_pct: float
    delta_avg_pnl_pct: float  # variant − base, averaged over the paired runs
    delta_t: float  # paired t-statistic; |t| ≥ 2 with n ≥ 10 is the bar
    base_trades: int
    variant_trades: int


class SweepLeaderboard(BaseModel):
    n_runs: int
    templates: list[SweepTemplateStat]
    # Ranked by delta_t: the gate's measured effect, not its average.
    pairs: list[SweepPairStat] = []
    top_runs: list[SweepRunStat]
    bottom_runs: list[SweepRunStat]
