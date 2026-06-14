"""Customer API routes."""

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import CustomerConfigurationServiceDep, CustomerServiceDep
from crypto_ai.schemas.customer import CustomerCreate, CustomerResponse, CustomerUpdate
from crypto_ai.schemas.customer_configuration import (
    CustomerConfigurationCreate,
    CustomerConfigurationResponse,
    CustomerConfigurationUpdate,
)

router = APIRouter()


@router.post("", response_model=CustomerResponse, status_code=201)
async def create_customer(
    data: CustomerCreate,
    service: CustomerServiceDep,
) -> CustomerResponse:
    """Create a new customer."""
    customer = await service.create(data)
    return CustomerResponse.model_validate(customer)


@router.get("", response_model=list[CustomerResponse])
async def list_customers(
    service: CustomerServiceDep,
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
    include_inactive: bool = Query(default=False),
) -> list[CustomerResponse]:
    """Get all customers with pagination."""
    customers = await service.get_all(
        limit=limit,
        offset=offset,
        include_inactive=include_inactive,
    )
    return [CustomerResponse.model_validate(c) for c in customers]


@router.get("/{customer_id}", response_model=CustomerResponse)
async def get_customer(
    customer_id: str,
    service: CustomerServiceDep,
) -> CustomerResponse:
    """Get a customer by ID."""
    customer = await service.get(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CustomerResponse.model_validate(customer)


@router.patch("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: str,
    data: CustomerUpdate,
    service: CustomerServiceDep,
) -> CustomerResponse:
    """Update a customer."""
    customer = await service.update(customer_id, data)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CustomerResponse.model_validate(customer)


@router.post("/{customer_id}/opened", response_model=CustomerResponse)
async def touch_customer_opened(
    customer_id: str,
    service: CustomerServiceDep,
) -> CustomerResponse:
    """Update last_opened_at timestamp for a customer."""
    customer = await service.touch_last_opened(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CustomerResponse.model_validate(customer)


@router.delete("/{customer_id}", status_code=204)
async def delete_customer(
    customer_id: str,
    service: CustomerServiceDep,
    hard_delete: bool = Query(default=False),
) -> None:
    """Delete a customer (soft delete by default)."""
    deleted = await service.delete(customer_id, hard_delete=hard_delete)
    if not deleted:
        raise HTTPException(status_code=404, detail="Customer not found")


# Customer Configuration endpoints


@router.get("/{customer_id}/configuration", response_model=CustomerConfigurationResponse)
async def get_customer_configuration(
    customer_id: str,
    service: CustomerConfigurationServiceDep,
) -> CustomerConfigurationResponse:
    """Get customer configuration."""
    config = await service.get_by_customer(customer_id)
    if not config:
        raise HTTPException(status_code=404, detail="Customer configuration not found")
    return CustomerConfigurationResponse.model_validate(config)


@router.post(
    "/{customer_id}/configuration", response_model=CustomerConfigurationResponse, status_code=201
)
async def create_customer_configuration(
    customer_id: str,
    data: CustomerConfigurationCreate,
    service: CustomerConfigurationServiceDep,
) -> CustomerConfigurationResponse:
    """Create customer configuration."""
    config = await service.create(customer_id, data)
    return CustomerConfigurationResponse.model_validate(config)


@router.patch("/{customer_id}/configuration", response_model=CustomerConfigurationResponse)
async def update_customer_configuration(
    customer_id: str,
    data: CustomerConfigurationUpdate,
    service: CustomerConfigurationServiceDep,
) -> CustomerConfigurationResponse:
    """Update customer configuration."""
    config = await service.update(customer_id, data)
    if not config:
        raise HTTPException(status_code=404, detail="Customer configuration not found")
    return CustomerConfigurationResponse.model_validate(config)


@router.delete("/{customer_id}/configuration", status_code=204)
async def delete_customer_configuration(
    customer_id: str,
    service: CustomerConfigurationServiceDep,
    hard_delete: bool = Query(default=False),
) -> None:
    """Delete customer configuration (soft delete by default)."""
    deleted = await service.delete(customer_id, hard_delete=hard_delete)
    if not deleted:
        raise HTTPException(status_code=404, detail="Customer configuration not found")
