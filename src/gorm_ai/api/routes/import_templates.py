"""Import template API routes."""

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import ImportTemplateServiceDep
from gorm_ai.schemas.import_template import (
    ImportTemplateCreate,
    ImportTemplateElementCreate,
    ImportTemplateElementResponse,
    ImportTemplateResponse,
    ImportTemplateUpdate,
)

router = APIRouter()


@router.get("", response_model=list[ImportTemplateResponse])
async def list_import_templates(
    customer_id: str,
    service: ImportTemplateServiceDep,
) -> list[ImportTemplateResponse]:
    """List all import templates for a customer."""
    templates = await service.list_by_customer(customer_id)
    return [ImportTemplateResponse.model_validate(t) for t in templates]


@router.post("", response_model=ImportTemplateResponse, status_code=201)
async def create_import_template(
    data: ImportTemplateCreate,
    service: ImportTemplateServiceDep,
) -> ImportTemplateResponse:
    """Create a new import template."""
    template = await service.create(data)
    return ImportTemplateResponse.model_validate(template)


@router.get("/{template_id}", response_model=ImportTemplateResponse)
async def get_import_template(
    template_id: str,
    service: ImportTemplateServiceDep,
) -> ImportTemplateResponse:
    """Get an import template by ID."""
    template = await service.get(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Import template not found")
    return ImportTemplateResponse.model_validate(template)


@router.patch("/{template_id}", response_model=ImportTemplateResponse)
async def update_import_template(
    template_id: str,
    data: ImportTemplateUpdate,
    service: ImportTemplateServiceDep,
) -> ImportTemplateResponse:
    """Update an import template."""
    template = await service.update(template_id, data)
    if not template:
        raise HTTPException(status_code=404, detail="Import template not found")
    return ImportTemplateResponse.model_validate(template)


@router.delete("/{template_id}", status_code=204)
async def delete_import_template(
    template_id: str,
    service: ImportTemplateServiceDep,
) -> None:
    """Delete an import template (soft delete)."""
    deleted = await service.delete(template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Import template not found")


@router.post("/{template_id}/elements", response_model=ImportTemplateElementResponse, status_code=201)
async def add_element(
    template_id: str,
    data: ImportTemplateElementCreate,
    service: ImportTemplateServiceDep,
) -> ImportTemplateElementResponse:
    """Add an element to a template."""
    element = await service.add_element(template_id, data)
    if not element:
        raise HTTPException(status_code=404, detail="Import template not found")
    return ImportTemplateElementResponse.model_validate(element)


@router.delete("/elements/{element_id}", status_code=204)
async def remove_element(
    element_id: str,
    service: ImportTemplateServiceDep,
) -> None:
    """Remove an element from a template."""
    deleted = await service.remove_element(element_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Element not found")


@router.put("/{template_id}/elements/reorder", status_code=204)
async def reorder_elements(
    template_id: str,
    element_ids: list[str],
    service: ImportTemplateServiceDep,
) -> None:
    """Reorder elements in a template."""
    success = await service.reorder_elements(template_id, element_ids)
    if not success:
        raise HTTPException(status_code=404, detail="Import template not found")
