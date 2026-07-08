"""API routes for crypto orchestration groups (global; grain pooled/pair)."""

from fastapi import APIRouter, HTTPException

from crypto_ai.api.deps import DbSession
from crypto_ai.database.models.orchestration_group import OrchestrationGroup
from crypto_ai.schemas.orchestration import (
    CalibrateGroupRequest,
    CalibrateGroupResponse,
    CreateOrchestrationGroupRequest,
    OrchestrationGroupDetailResponse,
    OrchestrationGroupResponse,
    UpdateOrchestrationGroupRequest,
)
from crypto_ai.services.orchestration import OrchestrationService

router = APIRouter()


def _summary(g: OrchestrationGroup) -> OrchestrationGroupResponse:
    return OrchestrationGroupResponse(
        id=g.id,
        name=g.name,
        description=g.description,
        notes=g.notes,
        model_composition=g.model_composition,
        top_n=g.top_n,
        calibration_metric=g.calibration_metric,
        prediction_target=g.prediction_target,
        quote_asset=g.quote_asset,
        interval=g.interval,
        coin_ids=list(g.coin_ids or []),
        status=g.status,
        last_calibrated_at=g.last_calibrated_at,
        last_calibration_score=g.last_calibration_score,
        created_at=g.created_at,
        updated_at=g.updated_at,
        active=g.active,
    )


def _detail(
    g: OrchestrationGroup, engines: list[dict], task_id: str | None = None
) -> OrchestrationGroupDetailResponse:
    return OrchestrationGroupDetailResponse(
        **_summary(g).model_dump(),
        engine_slugs=list(g.engine_slugs or []),
        calibrated_slugs=list(g.calibrated_slugs or []),
        calibrated_basis=dict(g.calibrated_basis or {}),
        engine_workers=dict(g.engine_workers or {}),
        engine_params=dict(g.engine_params or {}),
        engines=engines,
        task_id=task_id,
    )


async def _dispatch_calibration(
    session, group, name: str, engine_slugs: list[str], operation: str = "select",
) -> str:
    """Fan out per-engine calibration sub-tasks (each to its assigned worker
    queue) and record the aggregating task. Returns the task id."""
    from crypto_ai.services.task import TaskService
    from crypto_ai.tasks.orchestration import dispatch_calibration_chord

    task_id = dispatch_calibration_chord(
        group.id, engine_slugs, dict(group.engine_workers or {}), operation,
    )
    await TaskService(session).create(
        task_id, "orchestration", name=name, request_data={"group_id": group.id},
    )
    await session.commit()
    return task_id


@router.post("", response_model=OrchestrationGroupDetailResponse, status_code=201)
async def create_orchestration_group(
    request: CreateOrchestrationGroupRequest,
    session: DbSession,
) -> OrchestrationGroupDetailResponse:
    """Create an orchestration group as a ``draft`` (no calibration runs yet)."""
    service = OrchestrationService(session)
    try:
        group = await service.create_group_draft(
            name=request.name,
            engine_slugs=request.engine_slugs,
            metric=request.metric,
            top_n=request.top_n,
            description=request.description,
            notes=request.notes,
            prediction_target=request.prediction_target,
            quote_asset=request.quote_asset,
            interval=request.interval,
            coin_ids=request.coin_ids,
            engine_params=request.engine_params,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _detail(group, engines=[])


@router.get("", response_model=list[OrchestrationGroupResponse])
async def list_orchestration_groups(session: DbSession) -> list[OrchestrationGroupResponse]:
    """List all active orchestration groups."""
    service = OrchestrationService(session)
    groups = await service.list_groups()
    return [_summary(g) for g in groups]


@router.get("/{group_id}", response_model=OrchestrationGroupDetailResponse)
async def get_orchestration_group(
    group_id: str, session: DbSession
) -> OrchestrationGroupDetailResponse:
    """Get details of an orchestration group."""
    service = OrchestrationService(session)
    group = await service.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    engines = await service.get_group_engines(group_id)
    return _detail(group, engines=engines)


@router.put("/{group_id}", response_model=OrchestrationGroupResponse)
async def update_orchestration_group(
    group_id: str,
    request: UpdateOrchestrationGroupRequest,
    session: DbSession,
) -> OrchestrationGroupResponse:
    """Update an orchestration group's definition (no recalibration)."""
    service = OrchestrationService(session)
    try:
        group = await service.update_group(
            group_id=group_id,
            name=request.name,
            description=request.description,
            notes=request.notes,
            metric=request.metric,
            top_n=request.top_n,
            prediction_target=request.prediction_target,
            quote_asset=request.quote_asset,
            interval=request.interval,
            coin_ids=request.coin_ids,
            engine_slugs=request.engine_slugs,
            engine_params=request.engine_params,
        )
    except ValueError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e))
    return _summary(group)


@router.post("/{group_id}/select", response_model=CalibrateGroupResponse)
async def select_orchestration_models(
    group_id: str,
    request: CalibrateGroupRequest,
    session: DbSession,
) -> CalibrateGroupResponse:
    """Run **Selection**: score the full candidate pool, keep the top-N, and set
    the blend weights (dispatched to Celery workers)."""
    service = OrchestrationService(session)
    try:
        group = await service.mark_running(group_id, "selecting", request.engine_workers)
    except ValueError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e))
    task_id = await _dispatch_calibration(
        session, group, f"Select models — {group.name}", list(group.engine_slugs or []),
    )
    return CalibrateGroupResponse(id=group.id, task_id=task_id, status=group.status)


@router.post("/{group_id}/reweight", response_model=CalibrateGroupResponse)
async def reweight_orchestration_group(
    group_id: str,
    request: CalibrateGroupRequest,
    session: DbSession,
) -> CalibrateGroupResponse:
    """Run **Reweight**: keep the selected model set fixed and refresh only its
    blend weights. Requires a prior Selection (else 400)."""
    service = OrchestrationService(session)
    group = await service.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    selected = service.selected_slugs(group)
    if not selected:
        raise HTTPException(
            status_code=400,
            detail="Group has no selected models yet — run Selection first.",
        )
    group = await service.mark_running(group_id, "reweighting", request.engine_workers)
    task_id = await _dispatch_calibration(
        session, group, f"Reweight — {group.name}", selected, operation="reweight",
    )
    return CalibrateGroupResponse(id=group.id, task_id=task_id, status=group.status)


@router.delete("/{group_id}", status_code=204)
async def delete_orchestration_group(group_id: str, session: DbSession) -> None:
    """Soft delete an orchestration group."""
    service = OrchestrationService(session)
    try:
        await service.delete_group(group_id)
    except ValueError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e))
