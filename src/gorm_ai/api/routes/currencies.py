"""Currency API routes."""

from fastapi import APIRouter
from sqlalchemy import select

from gorm_ai.api.deps import DbSession
from gorm_ai.database.models.currency import Currency
from gorm_ai.schemas.currency import CurrencyResponse

router = APIRouter()


@router.get("", response_model=list[CurrencyResponse])
async def list_currencies(
    session: DbSession,
) -> list[CurrencyResponse]:
    """List all currencies."""
    result = await session.execute(
        select(Currency).where(Currency.active.is_(True)).order_by(Currency.name)
    )
    currencies = result.scalars().all()
    return [CurrencyResponse.model_validate(c) for c in currencies]
