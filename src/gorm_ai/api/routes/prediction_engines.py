"""Prediction engine API routes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from gorm_ai.api.deps import (
    PredictionEngineParameterServiceDep,
    PredictionEngineServiceDep,
    TaskServiceDep,
)
from gorm_ai.schemas.prediction import (
    PredictionEngineCreate,
    PredictionEngineParameterCreate,
    PredictionEngineParameterResponse,
    PredictionEngineResponse,
    PredictionEngineUpdate,
)


class FinetuneRequest(BaseModel):
    """Schema for fine-tuning request."""
    prediction_engine_id: str
    customer_id: str
    outlet_group_id: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    context_length: int = 512
    horizon: int = 64
    epochs: int = 50
    learning_rate: float = 0.001
    batch_size: int = 32
    early_stopping_patience: int = 0
    worker: str | None = None


class FinetuneTaskResponse(BaseModel):
    task_id: str
    status: str
    progress: float
    message: str | None
    created_at: str


class FinetuneCountResponse(BaseModel):
    count: int

router = APIRouter()


@router.get("", response_model=list[PredictionEngineResponse])
async def list_prediction_engines(
    service: PredictionEngineServiceDep,
) -> list[PredictionEngineResponse]:
    """List all prediction engines."""
    engines = await service.list_all()
    return [PredictionEngineResponse.model_validate(e) for e in engines]


@router.post("", response_model=PredictionEngineResponse, status_code=201)
async def create_prediction_engine(
    data: PredictionEngineCreate,
    service: PredictionEngineServiceDep,
) -> PredictionEngineResponse:
    """Create a new prediction engine."""
    engine = await service.create(data)
    return PredictionEngineResponse.model_validate(engine)


@router.get("/{engine_id}", response_model=PredictionEngineResponse)
async def get_prediction_engine(
    engine_id: str,
    service: PredictionEngineServiceDep,
) -> PredictionEngineResponse:
    """Get a prediction engine by ID."""
    engine = await service.get(engine_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Prediction engine not found")
    return PredictionEngineResponse.model_validate(engine)


@router.patch("/{engine_id}", response_model=PredictionEngineResponse)
async def update_prediction_engine(
    engine_id: str,
    data: PredictionEngineUpdate,
    service: PredictionEngineServiceDep,
) -> PredictionEngineResponse:
    """Update a prediction engine."""
    engine = await service.update(engine_id, data)
    if not engine:
        raise HTTPException(status_code=404, detail="Prediction engine not found")
    return PredictionEngineResponse.model_validate(engine)


@router.delete("/{engine_id}", status_code=204)
async def delete_prediction_engine(
    engine_id: str,
    service: PredictionEngineServiceDep,
) -> None:
    """Soft-delete a prediction engine."""
    if not await service.delete(engine_id):
        raise HTTPException(status_code=404, detail="Prediction engine not found")


# ── Parameters ────────────────────────────────────────────────────────────────


@router.get("/{engine_id}/parameters", response_model=list[PredictionEngineParameterResponse])
async def list_engine_parameters(
    engine_id: str,
    service: PredictionEngineParameterServiceDep,
) -> list[PredictionEngineParameterResponse]:
    """List parameters for a prediction engine."""
    params = await service.list_by_engine(engine_id)
    return [PredictionEngineParameterResponse.model_validate(p) for p in params]


@router.post(
    "/{engine_id}/parameters",
    response_model=PredictionEngineParameterResponse,
    status_code=201,
)
async def create_engine_parameter(
    engine_id: str,
    data: PredictionEngineParameterCreate,
    service: PredictionEngineParameterServiceDep,
) -> PredictionEngineParameterResponse:
    """Add a parameter to a prediction engine."""
    param = await service.create(engine_id, data)
    return PredictionEngineParameterResponse.model_validate(param)


@router.post(
    "/parameters/{param_id}/toggle-selected",
    response_model=list[PredictionEngineParameterResponse],
)
async def toggle_parameter_selected(
    param_id: str,
    service: PredictionEngineParameterServiceDep,
) -> list[PredictionEngineParameterResponse]:
    """Toggle selection of a parameter (deselects others in the same group)."""
    param = await service.toggle_selected(param_id)
    if not param:
        raise HTTPException(status_code=404, detail="Parameter not found")
    # Return updated full list for the engine
    params = await service.list_by_engine(param.prediction_engine_id)
    return [
        PredictionEngineParameterResponse.model_validate(p)
        for p in params
    ]


@router.delete("/parameters/{param_id}", status_code=204)
async def delete_engine_parameter(
    param_id: str,
    service: PredictionEngineParameterServiceDep,
) -> None:
    """Soft-delete a prediction engine parameter."""
    if not await service.delete(param_id):
        raise HTTPException(status_code=404, detail="Parameter not found")


# ── Fine-tuning ──────────────────────────────────────────────────────────────


@router.get("/{engine_id}/finetune/models")
async def list_finetune_models(
    engine_id: str,
    engine_service: PredictionEngineServiceDep,
) -> list[str]:
    """List available finetuned model subdirectories for an engine."""
    import os

    engine = await engine_service.get(engine_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Engine not found")
    if not engine.finetuned_model_path:
        return []
    base = engine.finetuned_model_path
    if not os.path.isdir(base):
        return []
    return sorted(
        name
        for name in os.listdir(base)
        if os.path.isdir(os.path.join(base, name))
        and any(
            f.endswith((".safetensors", ".bin"))
            for f in os.listdir(os.path.join(base, name))
        )
    )


@router.get("/{engine_id}/finetune/count", response_model=FinetuneCountResponse)
async def get_finetune_count(
    engine_id: str,
    task_service: TaskServiceDep,
) -> FinetuneCountResponse:
    """Count customers that have been fine-tuned for this engine."""
    from gorm_ai.services.finetune import FinetuneService

    service = FinetuneService(task_service.session)
    count = await service.count_finetuned(engine_id)
    return FinetuneCountResponse(count=count)


@router.post("/finetune", response_model=FinetuneTaskResponse, status_code=202)
async def start_finetune(
    data: FinetuneRequest,
    task_service: TaskServiceDep,
) -> FinetuneTaskResponse:
    """Start a fine-tuning task asynchronously."""
    from datetime import UTC, datetime

    from gorm_ai.tasks.finetuning import run_finetune_task

    dispatch_kwargs: dict = {"args": [data.model_dump(mode="json")]}
    if data.worker:
        dispatch_kwargs["queue"] = data.worker

    task = run_finetune_task.apply_async(**dispatch_kwargs)
    task_name = f"Finetune {data.customer_id[:8]}"
    await task_service.create(task.id, "finetune", data.customer_id, name=task_name)

    now = datetime.now(UTC)
    return FinetuneTaskResponse(
        task_id=task.id,
        status="pending",
        progress=0,
        message="Fine-tuning task queued",
        created_at=now.isoformat(),
    )
