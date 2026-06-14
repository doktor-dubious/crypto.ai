"""Cohort audit API routes."""

from collections import Counter

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from crypto_ai.api.deps import CohortAuditServiceDep, DbSession
from crypto_ai.database.models.outlet import Outlet
from crypto_ai.database.models.outlet_info import OutletInfo
from crypto_ai.schemas.cohort_audit import (
    CohortAuditRequest,
    CohortAuditResponse,
    OutletInfoKeyEntry,
    OutletInfoKeysResponse,
    OutletInfoValueEntry,
    OutletInfoValuesResponse,
)

router = APIRouter()


@router.post("/cohort-audit", response_model=CohortAuditResponse)
async def cohort_audit(
    data: CohortAuditRequest,
    service: CohortAuditServiceDep,
) -> CohortAuditResponse:
    """Run a per-cohort driver-skip audit over the customer's outlets,
    partitioning on `outlet_info.key=<outlet_info_key>`."""
    result = await service.audit(
        customer_id=data.customer_id,
        outlet_info_key=data.outlet_info_key,
        start_date=data.start_date,
        end_date=data.end_date,
        outlet_info_values=data.outlet_info_values,
        sequenced=data.sequenced,
        shared_driver=data.shared_driver,
        skip_threshold_pct=data.skip_threshold_pct,
        min_baseline=data.min_baseline,
        delivery_floor=data.delivery_floor,
    )
    return CohortAuditResponse(**result)


@router.get("/outlet-info/keys", response_model=OutletInfoKeysResponse)
async def list_outlet_info_keys(
    session: DbSession,
    customer_id: str = Query(...),
) -> OutletInfoKeysResponse:
    """List distinct `outlet_info.key` values present on this customer's
    outlets, with the number of outlets carrying each key."""
    result = await session.execute(
        select(OutletInfo.key, func.count(func.distinct(OutletInfo.outlet_id)))
        .join(Outlet, Outlet.id == OutletInfo.outlet_id)
        .where(
            Outlet.customer_id == customer_id,
            Outlet.active.is_(True),
            OutletInfo.active.is_(True),
        )
        .group_by(OutletInfo.key)
        .order_by(OutletInfo.key)
    )
    entries = [
        OutletInfoKeyEntry(key=row[0], outlet_count=int(row[1]))
        for row in result.all()
    ]
    return OutletInfoKeysResponse(keys=entries)


@router.get("/outlet-info/values", response_model=OutletInfoValuesResponse)
async def list_outlet_info_values(
    session: DbSession,
    customer_id: str = Query(...),
    key: str = Query(...),
) -> OutletInfoValuesResponse:
    """List distinct values for a given outlet_info key with outlet counts."""
    result = await session.execute(
        select(OutletInfo.value)
        .join(Outlet, Outlet.id == OutletInfo.outlet_id)
        .where(
            Outlet.customer_id == customer_id,
            Outlet.active.is_(True),
            OutletInfo.key == key,
            OutletInfo.active.is_(True),
            OutletInfo.value.is_not(None),
        )
    )
    counter: Counter[str] = Counter()
    for row in result.all():
        counter[row[0]] += 1
    # Sort values naturally: numeric first if all parse as int, else alpha.
    items = list(counter.items())
    try:
        items.sort(key=lambda kv: (int(kv[0]), kv[0]))
    except (ValueError, TypeError):
        items.sort(key=lambda kv: kv[0])
    entries = [
        OutletInfoValueEntry(value=v, outlet_count=c) for v, c in items
    ]
    return OutletInfoValuesResponse(key=key, values=entries)
