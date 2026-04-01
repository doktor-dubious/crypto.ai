"""Pydantic schemas for chat / natural language interface."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


# ── Requests ──────────────────────────────────────────────────────────────────

class ChatSendRequest(BaseModel):
    """Send a message in a chat session (or start a new one)."""

    customer_id: str
    session_id: str | None = None  # None = create new session
    message: str


class ChatSessionUpdate(BaseModel):
    """Update a chat session (rename / star)."""

    title: str | None = None
    starred: bool | None = None


# ── Response building blocks ──────────────────────────────────────────────────

class ChartSeries(BaseModel):
    """A single data series for a chart."""

    name: str
    data_key: str
    color: str | None = None


class ChartConfig(BaseModel):
    """Describes a chart to render on the frontend."""

    type: str  # "line" | "bar" | "pie"
    title: str | None = None
    x_key: str
    series: list[ChartSeries]
    data: list[dict]


class OutletRef(BaseModel):
    """A clickable outlet reference returned in results."""

    outlet_id: str
    name: str
    city: str | None = None
    state: str | None = None
    value: float | None = None
    value_label: str | None = None


class ChatMessageResponse(BaseModel):
    """A single message in the conversation."""

    id: str
    role: str  # "user" | "assistant"
    content: str
    chart: ChartConfig | None = None
    outlets: list[OutletRef] | None = None
    created_at: datetime


class ChatSessionResponse(BaseModel):
    """A chat session (without messages — for listing)."""

    id: str
    customer_id: str
    title: str
    starred: bool = False
    created_at: datetime
    updated_at: datetime


class ChatSessionDetailResponse(BaseModel):
    """A chat session with its full message history."""

    id: str
    customer_id: str
    title: str
    messages: list[ChatMessageResponse]
    created_at: datetime
    updated_at: datetime


class ChatSendResponse(BaseModel):
    """Response after sending a message."""

    session_id: str
    message: ChatMessageResponse
