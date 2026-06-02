"""Schemas for the cohort audit endpoint."""

from datetime import date

from pydantic import BaseModel, Field


class CohortAuditRequest(BaseModel):
    """Audit driver-skip patterns by partitioning a customer's outlets on
    `outlet_info.key=<outlet_info_key>` and analysing each cohort.
    """

    customer_id: str
    outlet_info_key: str
    start_date: date
    end_date: date
    outlet_info_values: list[str] | None = None
    sequenced: bool = False
    shared_driver: bool = False
    skip_threshold_pct: float = Field(default=0.2, ge=0.0, le=1.0)
    min_baseline: float = Field(default=3.0, ge=0.0)
    delivery_floor: int = Field(default=2, ge=0)


class CohortOutletStat(BaseModel):
    outlet_id: str
    outlet_name: str
    ext_id: str
    skip_count: int
    above_floor_skip_count: int
    skip_rate: float
    active_open_days: int
    rank: int
    inferred_sequence_rank: int | None = None
    no_report_count: int = 0


class CohortSkipEvent(BaseModel):
    date: date
    weekday: int
    skipped_outlet_ids: list[str]
    skipped_count: int


class CohortResult(BaseModel):
    cohort_value: str
    outlet_count: int
    skip_event_count: int
    total_skip_observations: int
    overall_skip_rate: float
    tcs: float | None = None
    tcs_p_value: float | None = None
    no_report_count: int = 0
    weekday_distribution: list[int]
    top_weekday: int | None = None
    outlets: list[CohortOutletStat]
    skip_events: list[CohortSkipEvent]
    inferred_tail_outlets: list[str] | None = None
    sequence_confidence: str | None = None


class CohortAuditWindow(BaseModel):
    start_date: date
    end_date: date


class CohortAuditResponse(BaseModel):
    cohorts: list[CohortResult]
    universe_size: int
    cohorts_with_signal: int
    skip_detection_window: CohortAuditWindow
    notes: list[str]


class OutletInfoKeyEntry(BaseModel):
    key: str
    outlet_count: int


class OutletInfoKeysResponse(BaseModel):
    keys: list[OutletInfoKeyEntry]


class OutletInfoValueEntry(BaseModel):
    value: str
    outlet_count: int


class OutletInfoValuesResponse(BaseModel):
    key: str
    values: list[OutletInfoValueEntry]
