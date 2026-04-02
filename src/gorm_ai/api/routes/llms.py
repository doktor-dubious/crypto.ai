"""LLM provider and submodel API routes."""

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from gorm_ai.api.deps import DbSession
from gorm_ai.database.models.llm import Llm
from gorm_ai.database.models.llm_submodel import LlmSubmodel

router = APIRouter()


class LlmResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None = None


class LlmSubmodelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None = None
    llm_id: str | None = None


@router.get("", response_model=list[LlmResponse])
async def list_llms(session: DbSession) -> list[LlmResponse]:
    """List all LLM providers."""
    result = await session.execute(
        select(Llm).where(Llm.active.is_(True)).order_by(Llm.name)
    )
    return [LlmResponse.model_validate(row) for row in result.scalars()]


@router.get("/submodels", response_model=list[LlmSubmodelResponse])
async def list_llm_submodels(session: DbSession) -> list[LlmSubmodelResponse]:
    """List all LLM submodels."""
    result = await session.execute(
        select(LlmSubmodel).where(LlmSubmodel.active.is_(True)).order_by(LlmSubmodel.name)
    )
    return [LlmSubmodelResponse.model_validate(row) for row in result.scalars()]
