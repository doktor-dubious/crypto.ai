"""Customer health check response schemas."""

from pydantic import BaseModel


class DateRange(BaseModel):
    earliest: str | None = None
    latest: str | None = None


class CoverageMetrics(BaseModel):
    """Data completeness & viability."""

    total_outlets: int
    outlets_with_sales: int
    outlets_with_enough_history: int
    coverage_ratio: float
    min_history_threshold_days: int
    date_range: DateRange
    median_history_days: float | None = None
    date_alignment_std_days: float | None = None
    pct_records_with_delivered: float
    pct_records_with_scan_sold: float
    pct_records_with_net_sold: float
    total_sales_records: int
    days_since_last_sale: int | None = None


class DeadOutlet(BaseModel):
    outlet_id: str
    ext_id: str
    name: str
    last_sale_date: str
    days_since_last_sale: int


class DuplicateGroup(BaseModel):
    outlet_ids: list[str]
    names: list[str]
    addresses: list[str | None]


class VolumeOutlet(BaseModel):
    outlet_id: str
    ext_id: str
    name: str
    total_sold: int
    pct_of_total: float


class StructuralFlags(BaseModel):
    """Structural red flags."""

    dead_outlets: list[DeadOutlet]
    dead_outlet_count: int
    duplicate_groups: list[DuplicateGroup]
    duplicate_group_count: int
    volume_top10_pct: float
    volume_top10_outlets: list[VolumeOutlet]
    delivery_config_coverage: float
    outlets_with_delivery_config: int
    outlets_without_delivery_config: int


class EngineReadiness(BaseModel):
    engine: str
    min_history: int
    qualifying_outlets: int
    total_outlets: int
    pct_qualifying: float


class ViabilityMetrics(BaseModel):
    """Overall customer viability."""

    engine_readiness: list[EngineReadiness]
    aggregate_cv: float | None = None
    overall_status: str


class HealthCheckResponse(BaseModel):
    """Full customer health check report."""

    customer_id: str
    customer_name: str
    coverage: CoverageMetrics
    structural: StructuralFlags
    viability: ViabilityMetrics
