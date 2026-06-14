"""Financial date API routes."""

from fastapi import APIRouter, HTTPException

from crypto_ai.api.deps import FinancialDateServiceDep
from crypto_ai.schemas.financial_date import (
    FinancialDateCreate,
    FinancialDateResponse,
    FinancialDateUpdate,
)

router = APIRouter()


@router.get("", response_model=list[FinancialDateResponse])
async def list_financial_dates(
    customer_id: str,
    service: FinancialDateServiceDep,
) -> list[FinancialDateResponse]:
    """List all financial dates for a customer."""
    dates = await service.list_by_customer(customer_id)
    return [FinancialDateResponse.model_validate(d) for d in dates]


@router.post("", response_model=FinancialDateResponse, status_code=201)
async def create_financial_date(
    data: FinancialDateCreate,
    service: FinancialDateServiceDep,
) -> FinancialDateResponse:
    """Create a new financial date."""
    financial_date = await service.create(data)
    return FinancialDateResponse.model_validate(financial_date)


@router.patch("/{financial_date_id}", response_model=FinancialDateResponse)
async def update_financial_date(
    financial_date_id: str,
    data: FinancialDateUpdate,
    service: FinancialDateServiceDep,
) -> FinancialDateResponse:
    """Update a financial date."""
    financial_date = await service.update(financial_date_id, data)
    if not financial_date:
        raise HTTPException(status_code=404, detail="Financial date not found")
    return FinancialDateResponse.model_validate(financial_date)


@router.delete("/{financial_date_id}", status_code=204)
async def delete_financial_date(
    financial_date_id: str,
    service: FinancialDateServiceDep,
) -> None:
    """Delete a financial date (soft delete)."""
    deleted = await service.delete(financial_date_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Financial date not found")
