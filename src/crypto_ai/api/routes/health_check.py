"""Customer health check API route."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from crypto_ai.api.deps import HealthCheckServiceDep
from crypto_ai.schemas.health_check import HealthCheckResponse

router = APIRouter()


class HealthCheckRequest(BaseModel):
    outlet_ids: list[str] | None = None


@router.post("/{customer_id}", response_model=HealthCheckResponse)
async def run_health_check(
    customer_id: str,
    data: HealthCheckRequest,
    service: HealthCheckServiceDep,
) -> HealthCheckResponse:
    """Run a health check for a customer's data quality and prediction readiness."""
    report = await service.run(customer_id, outlet_ids=data.outlet_ids)
    if not report:
        raise HTTPException(status_code=404, detail="Customer not found")
    return report
