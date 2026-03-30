"""Analysis Pydantic schemas for sales data insights."""

from datetime import date

from pydantic import BaseModel

# ─── Shared Request ──────────────────────────────────────────────────────────

class AnalysisRequest(BaseModel):
    """Shared request for all analysis endpoints."""

    customer_id: str
    outlet_ids: list[str]
    start_date: date
    end_date: date


# ─── Tab 1: Data Quality ────────────────────────────────────────────────────

class MissingDataGap(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    missing_dates: list[date]
    gap_count: int


class ZeroSalesAnomaly(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    dates: list[date]
    count: int


class FieldDiscrepancy(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    field: str  # "scan_sold" | "net_sold"
    avg_difference: float
    occurrence_count: int
    total_records: int


class LevelShift(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    shift_date: date
    before_mean: float
    after_mean: float
    magnitude: float
    magnitude_pct: float


class DataQualitySummary(BaseModel):
    total_missing_dates: int
    total_zero_sales: int
    total_discrepancies: int
    total_level_shifts: int
    outlets_with_issues: int
    total_expected_dates: int
    total_sales_records: int
    total_outlets_with_scan_or_net: int
    total_outlets_analyzed: int
    total_outlets: int


class DataQualityResponse(BaseModel):
    missing_data: list[MissingDataGap]
    zero_sales: list[ZeroSalesAnomaly]
    discrepancies: list[FieldDiscrepancy]
    level_shifts: list[LevelShift]
    summary: DataQualitySummary


# ─── Tab 2: Outlier Detection ───────────────────────────────────────────────

class DateOutlier(BaseModel):
    date: date
    value: float
    expected: float
    z_score: float
    direction: str  # "positive" | "negative"
    is_pad_date: bool
    pad_name: str | None = None


class RecurringDateOutlier(BaseModel):
    month: int
    day: int
    years: list[int]
    avg_z_score: float
    direction: str  # "positive" | "negative"
    is_registered_pad: bool
    pad_name: str | None = None


class OutlierResponse(BaseModel):
    recurring_sales: list[RecurringDateOutlier]
    non_recurring_sales: list[DateOutlier]
    recurring_delivery: list[RecurringDateOutlier]
    non_recurring_delivery: list[DateOutlier]


# ─── Tab 3: Patterns & Trends ───────────────────────────────────────────────

class WeeklyDataPoint(BaseModel):
    date: date
    value: float
    trend_value: float


class TrendInfo(BaseModel):
    slope: float
    slope_per_week: float
    direction: str  # "increasing" | "decreasing" | "flat"
    r_squared: float
    weekly_data: list[WeeklyDataPoint]


class Changepoint(BaseModel):
    date: date
    before_mean: float
    after_mean: float
    magnitude_pct: float


class YearlyProfilePoint(BaseModel):
    week: int
    month: int
    value: float


class SeasonalityInfo(BaseModel):
    has_weekly: bool
    has_yearly: bool
    weekly_strength: float
    yearly_strength: float | None = None
    weekly_profile: list[dict]  # [{weekday: int, avg_value: float}]
    yearly_profile: list[YearlyProfilePoint] = []


class WeekdayEffectOutlet(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    effect_strength: float
    weekday_means: list[float]  # Mon-Sun (7 values)


class DivergentOutlet(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    outlet_slope: float
    aggregate_slope: float
    divergence: float


class PatternsResponse(BaseModel):
    trend: TrendInfo
    changepoints: list[Changepoint]
    seasonality: SeasonalityInfo
    weekday_effects: list[WeekdayEffectOutlet]
    divergent_outlets: list[DivergentOutlet]


# ─── Tab 4: Delivery Performance ────────────────────────────────────────────

class HighReturnOutlet(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    avg_return_pct: float
    days_with_data: int


class SoldOutOutlet(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    sold_out_pct: float
    sold_out_days: int
    total_days: int


class WeekdayEfficiency(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    weekday: int
    avg_return_pct: float | None = None
    sold_out_pct: float
    day_count: int


class FixedAccount(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    cv: float
    sold_eq_delivered_pct: float
    avg_sold: float


class DeliveryPerformanceResponse(BaseModel):
    high_return: list[HighReturnOutlet]
    sold_out: list[SoldOutOutlet]
    weekday_efficiency: list[WeekdayEfficiency]
    fixed_accounts: list[FixedAccount]


# ─── Tab 5: Outlet Segmentation ─────────────────────────────────────────────

class OutletCluster(BaseModel):
    cluster_id: int
    outlet_ids: list[str]
    outlet_names: list[str]
    cluster_profile: list[float]  # 7-dim weekday profile (Mon-Sun)


class PredictabilityScore(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    cv: float
    difficulty: str  # "easy" | "moderate" | "hard"


class CorrelationCluster(BaseModel):
    cluster_id: int
    outlet_ids: list[str]
    outlet_names: list[str]
    avg_correlation: float


class SegmentationResponse(BaseModel):
    seasonal_clusters: list[OutletCluster]
    predictability: list[PredictabilityScore]
    correlation_clusters: list[CorrelationCluster]
