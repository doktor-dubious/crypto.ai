"""Fine-tune tracking routes."""

from fastapi import APIRouter, HTTPException, Query

from crypto_ai.api.deps import DbSession
from crypto_ai.schemas.fine_tune import FineTuneListResponse
from crypto_ai.services.fine_tune import FineTuneTrackingService

router = APIRouter()


@router.get("", response_model=FineTuneListResponse)
async def list_fine_tunes(
    session: DbSession,
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> FineTuneListResponse:
    service = FineTuneTrackingService(session)
    items, total = await service.list(limit=limit, offset=offset)
    return FineTuneListResponse(items=items, total=total)


@router.delete("/{fine_tune_id}", status_code=204)
async def delete_fine_tune(
    fine_tune_id: str,
    session: DbSession,
) -> None:
    service = FineTuneTrackingService(session)
    deleted = await service.delete(fine_tune_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Fine-tune record not found or still running")
    await session.commit()
