"""Schemas for the paper-trade performance analysis (Paper Trade → Analyze).

The analysis slices a template's closed trades into buckets — hour of day, 4-hour
block, trading session, weekday, side, exit reason — and reports, per bucket, how
the strategy performed and whether the difference is anything more than noise.
"""

from datetime import datetime

from pydantic import BaseModel


class BucketStat(BaseModel):
    """One slice of trades (e.g. "hour 14") with its performance and significance.

    Returns are the trades' fee-inclusive ``ret`` expressed in basis points, so
    slices pool cleanly across runs with different starting capital and coins.

    ``t_stat`` tests the slice's mean return against zero; ``t_vs_rest`` is a
    Welch t of this slice against every other trade in the analysis — that second
    number is the one that answers "is the strategy *better here than
    elsewhere*". Both are null when the slice is too small (n < 2) or has no
    spread. Neither is corrected for the number of slices tested.
    """

    key: str  # stable machine key ("14", "mon", "long", …)
    label: str  # display label ("14:00", "Mon", "long", …)
    n_trades: int = 0
    n_wins: int = 0
    n_losses: int = 0
    win_rate: float | None = None  # 0–1, over closed trades
    mean_bps: float | None = None
    median_bps: float | None = None
    sum_bps: float | None = None  # total return contributed by the slice
    sum_pnl: float = 0.0  # quote currency, summed across runs
    t_stat: float | None = None  # mean vs zero
    t_vs_rest: float | None = None  # Welch, this slice vs all other trades


class AnalysisTrade(BaseModel):
    """One closed trade, flattened for the "what if" filter.

    The UI lets the user intersect cuts (hours × weekdays × side) to see what the
    strategy would have returned had it only traded in those windows. An
    intersection can't be reconstructed from the pre-aggregated buckets, so the
    raw rows ride along with the response and the filtered stats are recomputed
    in the browser as the selection changes.
    """

    entry_time: datetime  # UTC; the client applies its own timezone shift
    ret_bps: float  # fee-inclusive return, basis points
    pnl: float  # quote currency (only comparable within a run)
    side: str
    exit_reason: str | None = None


class PaperTradeAnalysis(BaseModel):
    """Full analysis for one set of trades.

    Two producers share this shape: a strategy template's pooled PAPER trades
    (``template_id`` set, ``n_runs`` > 0) and the trades a BACKTEST produced on a
    strategy's Analytics tab (both null/zero — a backtest has no runs and no
    quote P/L, so every ``sum_pnl`` is 0 there).
    """

    template_id: str | None = None
    template_name: str | None = None
    scope: str = "template"  # "template" (all runs) | "run" (current run only)
    tz_offset_minutes: int = 0  # time-of-day buckets are shifted by this
    n_runs: int = 0
    n_trades: int = 0  # closed trades used
    n_open: int = 0  # excluded (no realised return yet)
    first_entry: datetime | None = None
    last_entry: datetime | None = None
    coins: list[str] = []  # ticker symbols the pooled runs traded
    # Closed trades dropped before bucketing because their run's coin fails the
    # tick guard (one price tick > ~0.1% of price): such returns are grid
    # quantization, and pooling them would let one coin mint phantom edges.
    n_tick_excluded: int = 0
    tick_excluded_symbols: list[str] = []
    # True when EVERY pooled run is on a tick-limited coin. Nothing is dropped
    # then — that would leave no analysis at all — but every figure is grid
    # quantization, so the UI must warn rather than hide.
    # ``tick_excluded_symbols`` names the affected coins even though
    # ``n_tick_excluded`` stays 0.
    tick_limited: bool = False

    overall: BucketStat
    by_hour: list[BucketStat] = []  # 24 entries, hour of entry
    by_hour_block: list[BucketStat] = []  # 6 entries, 4-hour blocks
    by_session: list[BucketStat] = []  # Asia / Europe / US, always UTC
    by_weekday: list[BucketStat] = []  # 7 entries, Mon-first
    by_side: list[BucketStat] = []
    by_exit_reason: list[BucketStat] = []

    trades: list[AnalysisTrade] = []  # raw rows, oldest first, for the what-if filter
    trades_truncated: bool = False  # older rows dropped past the row cap
