"""Token usage API routes."""

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from gorm_ai.api.deps import DbSession
from gorm_ai.database.models.token import Token, TokenLlm, TokenModel

router = APIRouter()


class TokenLlmResponse(BaseModel):
    """Per-LLM token usage."""

    llm_id: str
    llm_name: str
    used: int
    available: int


class TokenModelResponse(BaseModel):
    """Per-prediction-engine token usage."""

    prediction_engine_id: str
    engine_name: str
    used: int
    available: int


class TokenResponse(BaseModel):
    """Customer token usage summary."""

    id: str
    customer_id: str
    used: int
    available: int
    llms: list[TokenLlmResponse]
    models: list[TokenModelResponse]


@router.get("")
async def get_token_usage(
    customer_id: str = Query(...),
    session: DbSession = ...,
) -> TokenResponse | None:
    """Get token usage for a customer."""
    result = await session.execute(
        select(Token)
        .options(
            selectinload(Token.llms).selectinload(TokenLlm.llm),
            selectinload(Token.models).selectinload(
                TokenModel.prediction_engine,
            ),
        )
        .where(
            Token.customer_id == customer_id,
            Token.active.is_(True),
        )
    )
    token = result.scalar_one_or_none()
    if not token:
        return None

    return TokenResponse(
        id=token.id,
        customer_id=token.customer_id,
        used=token.used,
        available=token.available,
        llms=[
            TokenLlmResponse(
                llm_id=tl.llm_id,
                llm_name=tl.llm.name if tl.llm else "Unknown",
                used=tl.used,
                available=tl.available,
            )
            for tl in token.llms
            if tl.active
        ],
        models=[
            TokenModelResponse(
                prediction_engine_id=tm.prediction_engine_id,
                engine_name=(
                    tm.prediction_engine.name
                    if tm.prediction_engine else "Unknown"
                ),
                used=tm.used,
                available=tm.available,
            )
            for tm in token.models
            if tm.active
        ],
    )
