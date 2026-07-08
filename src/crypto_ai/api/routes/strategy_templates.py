"""API routes for trading-strategy parameter templates."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import StrategyTemplateServiceDep
from crypto_ai.schemas.strategy_template import (
    StrategyTemplateCreate,
    StrategyTemplateResponse,
    StrategyTemplateUpdate,
)

router = APIRouter()


@router.get("", response_model=list[StrategyTemplateResponse])
async def list_templates(
    service: StrategyTemplateServiceDep,
    strategy: Annotated[str | None, Query(description="Filter by strategy slug")] = None,
) -> list[StrategyTemplateResponse]:
    """List templates, optionally filtered to a single strategy."""
    return await service.list(strategy=strategy)


@router.post("", response_model=StrategyTemplateResponse, status_code=201)
async def create_template(
    data: StrategyTemplateCreate, service: StrategyTemplateServiceDep
) -> StrategyTemplateResponse:
    """Create a new template."""
    return await service.create(data)


@router.get("/{template_id}", response_model=StrategyTemplateResponse)
async def get_template(
    template_id: str, service: StrategyTemplateServiceDep
) -> StrategyTemplateResponse:
    """Get a template by id."""
    template = await service.get(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.patch("/{template_id}", response_model=StrategyTemplateResponse)
async def update_template(
    template_id: str, data: StrategyTemplateUpdate, service: StrategyTemplateServiceDep
) -> StrategyTemplateResponse:
    """Rename a template or replace its params/notes."""
    template = await service.update(template_id, data)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: str, service: StrategyTemplateServiceDep
) -> None:
    """Soft-delete a template."""
    if not await service.delete(template_id):
        raise HTTPException(status_code=404, detail="Template not found")
