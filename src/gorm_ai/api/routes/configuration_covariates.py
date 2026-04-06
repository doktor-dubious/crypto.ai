"""Configuration covariate API routes."""

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import ConfigurationCovariateServiceDep
from gorm_ai.schemas.configuration_covariate import (
    ConfigurationCovariateResponse,
    ConfigurationCovariateUpdate,
)

router = APIRouter()


@router.get("", response_model=list[ConfigurationCovariateResponse])
async def list_covariates(
    service: ConfigurationCovariateServiceDep,
    customer_id: str | None = None,
):
    """List resolved covariates for a customer (with global fallback), or global defaults."""
    if customer_id:
        return await service.list_for_customer(customer_id)
    return await service.list_global()


@router.patch("/{covariate_id}", response_model=ConfigurationCovariateResponse)
async def update_covariate(
    covariate_id: str,
    data: ConfigurationCovariateUpdate,
    service: ConfigurationCovariateServiceDep,
):
    """Toggle a covariate's active status."""
    row = await service.update(covariate_id, data.active)
    if not row:
        raise HTTPException(status_code=404, detail="Covariate not found")
    return row


@router.post("/ensure/{customer_id}", response_model=list[ConfigurationCovariateResponse])
async def ensure_customer_covariates(
    customer_id: str,
    service: ConfigurationCovariateServiceDep,
):
    """Create customer-specific covariate rows (copies of global defaults) if missing."""
    return await service.ensure_customer_rows(customer_id)
