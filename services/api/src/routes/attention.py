"""Agent attention notification routes."""

from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select, update

from src.database import AgentAttention
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, verify_session_access
from src.websocket.hub import emit_to_session

logger = structlog.get_logger()

router = APIRouter()


class AttentionResponse(BaseModel):
    """Attention item response."""

    id: str
    agent_id: str
    session_id: str
    attention_type: str
    title: str
    message: str
    priority: str
    is_read: bool
    is_dismissed: bool
    metadata: dict[str, Any] | None
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=list[AttentionResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_attention_items(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    *,
    include_dismissed: bool = False,
) -> list[AttentionResponse]:
    """List all attention items for a session.

    Args:
        session_id: The session ID.
        include_dismissed: Whether to include dismissed items (default False).

    Returns:
        List of attention items ordered by creation time (newest first).
    """
    # Verify session access
    await verify_session_access(session_id, request, db)

    # Build query
    query = select(AgentAttention).where(AgentAttention.session_id == session_id)

    if not include_dismissed:
        query = query.where(AgentAttention.is_dismissed == False)

    query = query.order_by(AgentAttention.created_at.desc())

    result = await db.execute(query)
    items = result.scalars().all()

    return [
        AttentionResponse(
            id=item.id,
            agent_id=item.agent_id,
            session_id=item.session_id,
            attention_type=item.attention_type,
            title=item.title,
            message=item.message,
            priority=item.priority,
            is_read=item.is_read,
            is_dismissed=item.is_dismissed,
            metadata=item.attention_metadata,
            created_at=item.created_at,
        )
        for item in items
    ]


@router.get("/unread-count")
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_unread_count(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, int]:
    """Get the count of unread attention items for a session.

    Args:
        session_id: The session ID.

    Returns:
        Dictionary with unread count.
    """
    # Verify session access
    await verify_session_access(session_id, request, db)

    # Count unread, non-dismissed items
    query = (
        select(func.count())
        .select_from(AgentAttention)
        .where(
            AgentAttention.session_id == session_id,
            AgentAttention.is_read == False,
            AgentAttention.is_dismissed == False,
        )
    )

    result = await db.execute(query)
    count = result.scalar() or 0

    return {"unread_count": count}


@router.post("/{attention_id}/read")
@limiter.limit(RATE_LIMIT_STANDARD)
async def mark_attention_read(
    session_id: str,
    attention_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Mark an attention item as read.

    Args:
        session_id: The session ID.
        attention_id: The attention item ID.

    Returns:
        Success message.
    """
    # Verify session access
    await verify_session_access(session_id, request, db)

    # Update the attention item
    result = await db.execute(
        update(AgentAttention)
        .where(
            AgentAttention.id == attention_id,
            AgentAttention.session_id == session_id,
        )
        .values(is_read=True)
        .returning(AgentAttention.id),
    )

    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Attention item not found")

    await db.commit()

    # Broadcast to session
    await emit_to_session(
        session_id,
        "agent_attention_read",
        {
            "session_id": session_id,
            "attention_id": attention_id,
        },
    )

    logger.debug("Attention marked as read", attention_id=attention_id)
    return {"message": "Marked as read"}


@router.post("/{attention_id}/dismiss")
@limiter.limit(RATE_LIMIT_STANDARD)
async def dismiss_attention(
    session_id: str,
    attention_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Dismiss an attention item.

    Args:
        session_id: The session ID.
        attention_id: The attention item ID.

    Returns:
        Success message.
    """
    # Verify session access
    await verify_session_access(session_id, request, db)

    # Get the attention item to find agent_id
    query = select(AgentAttention).where(
        AgentAttention.id == attention_id,
        AgentAttention.session_id == session_id,
    )
    result = await db.execute(query)
    attention = result.scalar_one_or_none()

    if not attention:
        raise HTTPException(status_code=404, detail="Attention item not found")

    agent_id = attention.agent_id

    # Update the attention item
    await db.execute(
        update(AgentAttention).where(AgentAttention.id == attention_id).values(is_dismissed=True),
    )
    await db.commit()

    # Broadcast to session
    await emit_to_session(
        session_id,
        "agent_attention_dismiss",
        {
            "session_id": session_id,
            "attention_id": attention_id,
            "agent_id": agent_id,
        },
    )

    logger.debug("Attention dismissed", attention_id=attention_id)
    return {"message": "Dismissed"}


@router.post("/dismiss-all")
@limiter.limit(RATE_LIMIT_STANDARD)
async def dismiss_all_attention(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Dismiss all attention items for a session.

    Args:
        session_id: The session ID.

    Returns:
        Success message.
    """
    # Verify session access
    await verify_session_access(session_id, request, db)

    # Update all non-dismissed items
    await db.execute(
        update(AgentAttention)
        .where(
            AgentAttention.session_id == session_id,
            AgentAttention.is_dismissed == False,
        )
        .values(is_dismissed=True),
    )
    await db.commit()

    # Broadcast to session
    await emit_to_session(
        session_id,
        "agent_attention_dismiss_all",
        {
            "session_id": session_id,
        },
    )

    logger.info("All attention items dismissed", session_id=session_id)
    return {"message": "All dismissed"}


@router.post("/dismiss-agent/{agent_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def dismiss_agent_attention(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Dismiss all attention items for a specific agent.

    Args:
        session_id: The session ID.
        agent_id: The agent ID.

    Returns:
        Success message.
    """
    # Verify session access
    await verify_session_access(session_id, request, db)

    # Update all non-dismissed items for this agent
    await db.execute(
        update(AgentAttention)
        .where(
            AgentAttention.session_id == session_id,
            AgentAttention.agent_id == agent_id,
            AgentAttention.is_dismissed == False,
        )
        .values(is_dismissed=True),
    )
    await db.commit()

    # Broadcast to session
    await emit_to_session(
        session_id,
        "agent_attention_dismiss",
        {
            "session_id": session_id,
            "agent_id": agent_id,
            "attention_id": None,  # Indicates all for this agent
        },
    )

    logger.info("Agent attention items dismissed", session_id=session_id, agent_id=agent_id)
    return {"message": "Agent attention dismissed"}
