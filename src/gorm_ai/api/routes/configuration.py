"""System configuration API routes."""

from fastapi import APIRouter, HTTPException

from gorm_ai.api.deps import ConfigurationServiceDep
from gorm_ai.schemas.configuration import ConfigurationResponse, ConfigurationUpdate

router = APIRouter()


@router.get("", response_model=ConfigurationResponse)
async def get_configuration(
    service: ConfigurationServiceDep,
) -> ConfigurationResponse:
    """Get system configuration."""
    config = await service.get()
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return ConfigurationResponse.model_validate(config)


@router.patch("", response_model=ConfigurationResponse)
async def update_configuration(
    data: ConfigurationUpdate,
    service: ConfigurationServiceDep,
) -> ConfigurationResponse:
    """Update system configuration."""
    config = await service.update(data)
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return ConfigurationResponse.model_validate(config)
