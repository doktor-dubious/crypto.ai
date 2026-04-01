"""User routes."""

from fastapi import APIRouter

from gorm_ai.api.deps import UserCustomerServiceDep
from gorm_ai.schemas.customer import CustomerResponse

router = APIRouter()


@router.get("/{user_id}/customers", response_model=list[CustomerResponse])
async def list_user_customers(
    user_id: str,
    service: UserCustomerServiceDep,
) -> list[CustomerResponse]:
    """Get all customers the user has access to."""
    customers = await service.get_customers_for_user(user_id)
    return [CustomerResponse.model_validate(c) for c in customers]
