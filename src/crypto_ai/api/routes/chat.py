"""API routes for the natural language chat interface."""

import structlog
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from crypto_ai.api.deps import DbSession
from crypto_ai.config import get_settings
from crypto_ai.database.models.chat import ChatMessage, ChatSession
from crypto_ai.database.models.user_customer import UserCustomer
from crypto_ai.schemas.chat import (
    ChatMessageResponse,
    ChatSendRequest,
    ChatSendResponse,
    ChatSessionDetailResponse,
    ChatSessionResponse,
    ChatSessionUpdate,
    ChartConfig,
    ChartSeries,
    OutletRef,
)
from crypto_ai.services.chat import ChatService

router = APIRouter()
log = structlog.get_logger("crypto_ai.api.chat")


def _msg_to_response(msg: ChatMessage) -> ChatMessageResponse:
    """Convert a DB message to a response schema."""
    role_map = {1: "user", 2: "assistant"}
    chart = None
    outlets = None

    if msg.data:
        if "chart" in msg.data:
            try:
                c = msg.data["chart"]
                chart = ChartConfig(
                    type=c["type"],
                    title=c.get("title"),
                    x_key=c["x_key"],
                    series=[ChartSeries(**s) for s in c["series"]],
                    data=c["data"],
                )
            except (KeyError, TypeError):
                pass
        if "outlets" in msg.data:
            try:
                outlets = [OutletRef(**o) for o in msg.data["outlets"]]
            except (KeyError, TypeError):
                pass

    return ChatMessageResponse(
        id=msg.id,
        role=role_map.get(msg.role, "unknown"),
        content=msg.content,
        chart=chart,
        outlets=outlets,
        created_at=msg.created_at,
    )


@router.post("", response_model=ChatSendResponse)
async def send_message(
    request: ChatSendRequest,
    session: DbSession,
) -> ChatSendResponse:
    """Send a message and get an AI response."""
    settings = get_settings()
    if not settings.claude_api:
        raise HTTPException(
            status_code=503,
            detail="Anthropic API key not configured",
        )

    # Check user has insight access to this customer
    if request.user_id:
        result = await session.execute(
            select(UserCustomer).where(
                UserCustomer.user_id == request.user_id,
                UserCustomer.customer_id == request.customer_id,
                UserCustomer.active.is_(True),
                UserCustomer.allow_insight.is_(True),
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(
                status_code=403,
                detail="No insight access to this customer",
            )

    chat_service = ChatService(session, settings.claude_api)
    try:
        return await chat_service.send_message(
            customer_id=request.customer_id,
            message=request.message,
            session_id=request.session_id,
        )
    except ValueError as exc:
        detail = str(exc)
        status = 429 if "busy" in detail or "rate" in detail.lower() else 400
        raise HTTPException(status_code=status, detail=detail)
    except Exception as exc:
        log.error("chat_error", error=str(exc))
        raise HTTPException(status_code=500, detail="Failed to process message")


@router.post("/stream")
async def send_message_stream(
    request: ChatSendRequest,
    session: DbSession,
) -> StreamingResponse:
    """Send a message and stream the AI response via SSE."""
    settings = get_settings()
    if not settings.claude_api:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured")

    # Permission check
    if request.user_id:
        result = await session.execute(
            select(UserCustomer).where(
                UserCustomer.user_id == request.user_id,
                UserCustomer.customer_id == request.customer_id,
                UserCustomer.active.is_(True),
                UserCustomer.allow_insight.is_(True),
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="No insight access")

    chat_service = ChatService(session, settings.claude_api)

    async def generate():
        try:
            async for event in chat_service.send_message_stream(
                customer_id=request.customer_id,
                message=request.message,
                session_id=request.session_id,
            ):
                yield event
        except Exception as exc:
            log.error("stream_error", error=str(exc))
            import json
            yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions", response_model=list[ChatSessionResponse])
async def list_sessions(
    session: DbSession,
    customer_id: str = Query(...),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
) -> list[ChatSessionResponse]:
    """List chat sessions for a customer, newest first."""
    result = await session.execute(
        select(ChatSession)
        .where(
            ChatSession.customer_id == customer_id,
            ChatSession.active.is_(True),
        )
        .order_by(ChatSession.updated_at.desc())
        .offset(offset)
        .limit(limit)
    )
    sessions = result.scalars().all()
    return [
        ChatSessionResponse(
            id=s.id,
            customer_id=s.customer_id,
            title=s.title,
            starred=s.starred,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in sessions
    ]


@router.get("/sessions/{session_id}", response_model=ChatSessionDetailResponse)
async def get_session_detail(
    session_id: str,
    session: DbSession,
) -> ChatSessionDetailResponse:
    """Get a chat session with its full message history."""
    result = await session.execute(
        select(ChatSession)
        .options(selectinload(ChatSession.messages))
        .where(
            ChatSession.id == session_id,
            ChatSession.active.is_(True),
        )
    )
    chat_session = result.scalar_one_or_none()
    if not chat_session:
        raise HTTPException(status_code=404, detail="Session not found")

    return ChatSessionDetailResponse(
        id=chat_session.id,
        customer_id=chat_session.customer_id,
        title=chat_session.title,
        messages=[
            _msg_to_response(m)
            for m in chat_session.messages
            if m.role in (1, 2) and m.active
        ],
        created_at=chat_session.created_at,
        updated_at=chat_session.updated_at,
    )


@router.patch("/sessions/{session_id}", response_model=ChatSessionResponse)
async def update_session(
    session_id: str,
    data: ChatSessionUpdate,
    session: DbSession,
) -> ChatSessionResponse:
    """Update a chat session (rename / star)."""
    result = await session.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.active.is_(True),
        )
    )
    chat_session = result.scalar_one_or_none()
    if not chat_session:
        raise HTTPException(status_code=404, detail="Session not found")

    if data.title is not None:
        chat_session.title = data.title
    if data.starred is not None:
        chat_session.starred = data.starred

    await session.commit()
    await session.refresh(chat_session)

    return ChatSessionResponse(
        id=chat_session.id,
        customer_id=chat_session.customer_id,
        title=chat_session.title,
        starred=chat_session.starred,
        created_at=chat_session.created_at,
        updated_at=chat_session.updated_at,
    )


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    session: DbSession,
) -> dict:
    """Soft-delete a chat session."""
    result = await session.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.active.is_(True),
        )
    )
    chat_session = result.scalar_one_or_none()
    if not chat_session:
        raise HTTPException(status_code=404, detail="Session not found")

    chat_session.active = False
    await session.commit()
    return {"status": "deleted"}
