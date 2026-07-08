"""Schemas for trading-strategy parameter templates."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class StrategyTemplateBase(BaseModel):
    """Base template fields."""

    name: str
    strategy: str
    params: dict[str, Any] = {}
    scope: dict[str, Any] | None = None
    description: str | None = None
    notes: str | None = None
    # Gate paper-trade entries behind an AI GO/NO_GO verdict.
    ai_confirmation: bool = False


class StrategyTemplateCreate(StrategyTemplateBase):
    """Create a template."""

    pass


class StrategyTemplateUpdate(BaseModel):
    """Update a template (all optional)."""

    name: str | None = None
    params: dict[str, Any] | None = None
    scope: dict[str, Any] | None = None
    description: str | None = None
    notes: str | None = None
    ai_confirmation: bool | None = None


class StrategyTemplateResponse(StrategyTemplateBase):
    """Template response."""

    id: str
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
