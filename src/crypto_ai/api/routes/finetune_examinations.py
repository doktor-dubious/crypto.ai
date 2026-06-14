"""Finetune examination API routes."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.api.deps import TaskServiceDep, get_db
from crypto_ai.database.models.finetune_examination import FinetuneExamination
from crypto_ai.schemas.finetune_examination import (
    FinetuneExaminationCreate,
    FinetuneExaminationListResponse,
    FinetuneExaminationResponse,
)

router = APIRouter()


def _to_response(exam: FinetuneExamination) -> FinetuneExaminationResponse:
    """Convert a FinetuneExamination ORM model to a response schema."""
    return FinetuneExaminationResponse(
        id=exam.id,
        customer_id=exam.customer_id,
        name=exam.name,
        description=exam.description,
        simulation_from=str(exam.simulation_from) if exam.simulation_from else None,
        simulation_to=str(exam.simulation_to) if exam.simulation_to else None,
        delay=exam.delay,
        outlet_group_id=exam.outlet_group_id,
        prediction_strategy_id=exam.prediction_strategy_id,
        base_engine=exam.base_engine,
        finetuned_engine=exam.finetuned_engine,
        finetuned_model=exam.finetuned_model,
        base_simulation_id=exam.base_simulation_id,
        finetuned_simulation_id=exam.finetuned_simulation_id,
        status=exam.status,
        error=exam.error,
        started_at=exam.started_at.isoformat() if exam.started_at else None,
        completed_at=exam.completed_at.isoformat() if exam.completed_at else None,
        task_id=exam.task_id,
        base_stats=exam.base_stats,
        finetuned_stats=exam.finetuned_stats,
        base_zero_shot=exam.base_zero_shot,
        finetuned_zero_shot=exam.finetuned_zero_shot,
        base_overview=exam.base_overview,
        finetuned_overview=exam.finetuned_overview,
        conclusion=exam.conclusion,
        active=exam.active,
        created_at=exam.created_at.isoformat(),
        updated_at=exam.updated_at.isoformat(),
    )


@router.get("", response_model=FinetuneExaminationListResponse)
async def list_examinations(
    customer_id: str = Query(...),
    limit: int = Query(500, le=5000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> FinetuneExaminationListResponse:
    """List finetune examinations for a customer."""
    base_filter = (
        FinetuneExamination.customer_id == customer_id,
        FinetuneExamination.active.is_(True),
    )

    # Get total count
    count_result = await db.execute(
        select(func.count(FinetuneExamination.id)).where(*base_filter)
    )
    total = count_result.scalar_one()

    # Get items
    result = await db.execute(
        select(FinetuneExamination)
        .where(*base_filter)
        .order_by(desc(FinetuneExamination.created_at))
        .limit(limit)
        .offset(offset)
    )
    items = result.scalars().all()

    return FinetuneExaminationListResponse(
        items=[_to_response(item) for item in items],
        total=total,
    )


@router.post("", response_model=FinetuneExaminationResponse, status_code=201)
async def create_examination(
    data: FinetuneExaminationCreate,
    task_service: TaskServiceDep,
    db: AsyncSession = Depends(get_db),
) -> FinetuneExaminationResponse:
    """Create a finetune examination and dispatch the async task."""
    from crypto_ai.tasks.finetune_examination import run_finetune_examination

    exam = FinetuneExamination(
        customer_id=data.customer_id,
        name=data.name,
        description=data.description,
        simulation_from=date.fromisoformat(data.simulation_from),
        simulation_to=date.fromisoformat(data.simulation_to),
        delay=data.delay,
        outlet_group_id=data.outlet_group_id,
        prediction_strategy_id=data.prediction_strategy_id,
        base_engine=data.base_engine,
        finetuned_engine=data.finetuned_engine,
        finetuned_model=data.finetuned_model,
        status="pending",
    )
    db.add(exam)
    await db.flush()

    # Dispatch Celery task
    request_data = {
        "examination_id": exam.id,
        "customer_id": data.customer_id,
        "name": data.name,
        "description": data.description,
        "simulation_from": data.simulation_from,
        "simulation_to": data.simulation_to,
        "delay": data.delay,
        "outlet_group_id": data.outlet_group_id,
        "prediction_strategy_id": data.prediction_strategy_id,
        "base_engine": data.base_engine,
        "finetuned_engine": data.finetuned_engine,
        "finetuned_model": data.finetuned_model,
    }

    dispatch_kwargs: dict = {"args": [request_data]}
    if data.worker:
        dispatch_kwargs["queue"] = data.worker
    task = run_finetune_examination.apply_async(**dispatch_kwargs)

    exam.task_id = task.id
    await task_service.create(task.id, "finetune_examination", data.customer_id, name=data.name)
    await db.commit()
    await db.refresh(exam)

    return _to_response(exam)


@router.get("/{examination_id}", response_model=FinetuneExaminationResponse)
async def get_examination(
    examination_id: str,
    db: AsyncSession = Depends(get_db),
) -> FinetuneExaminationResponse:
    """Get a single finetune examination by ID."""
    result = await db.execute(
        select(FinetuneExamination).where(
            FinetuneExamination.id == examination_id,
            FinetuneExamination.active.is_(True),
        )
    )
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Finetune examination not found")
    return _to_response(exam)


@router.delete("/{examination_id}", status_code=204)
async def delete_examination(
    examination_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-delete a finetune examination."""
    result = await db.execute(
        select(FinetuneExamination).where(
            FinetuneExamination.id == examination_id,
            FinetuneExamination.active.is_(True),
        )
    )
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Finetune examination not found")
    exam.active = False
    await db.commit()
