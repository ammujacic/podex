"""Conversation session management routes.

Conversations are portable chat sessions that can be attached to any agent card.
They hold the message history and can be moved between agents.
"""

import contextlib
from datetime import datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.database import Agent as AgentModel
from src.database.models import ConversationMessage, ConversationSession
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id, verify_session_access
from src.websocket.hub import emit_to_session

logger = structlog.get_logger()

router = APIRouter()

# Type alias for current user dependency
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


# ============================================================================
# Pydantic Models
# ============================================================================


class ConversationMessageResponse(BaseModel):
    """Response model for a conversation message."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    role: str
    content: str
    thinking: str | None = None
    tool_calls: dict[str, Any] | None = None
    tool_results: dict[str, Any] | None = None
    model: str | None = None
    stop_reason: str | None = None
    usage: dict[str, Any] | None = None
    audio_url: str | None = None
    audio_duration_ms: int | None = None
    input_type: str = "text"
    transcription_confidence: float | None = None
    tts_summary: str | None = None
    created_at: datetime


class ConversationSessionResponse(BaseModel):
    """Response model for a conversation session."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    attached_to_agent_id: str | None = None  # Legacy field for backward compatibility
    attached_agent_ids: list[str] = []  # List of agent IDs that have this conversation attached
    message_count: int
    last_message_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def model_validate(cls, obj: Any, **kwargs: Any) -> "ConversationSessionResponse":
        """Custom validation to populate attached_agent_ids from relationship."""
        # Extract agent IDs from the relationship if available
        # Use try-except to handle cases where relationship might trigger lazy loading
        attached_agent_ids = []
        with contextlib.suppress(Exception):
            if hasattr(obj, "attached_agents") and obj.attached_agents:
                attached_agent_ids = [agent.id for agent in obj.attached_agents]

        # Fallback to __dict__ if available
        if (
            not attached_agent_ids
            and hasattr(obj, "__dict__")
            and "attached_agents" in obj.__dict__
        ):
            with contextlib.suppress(Exception):
                att = obj.__dict__["attached_agents"]
                attached_agent_ids = [agent.id for agent in att]

        # Use model_validate with a dict to properly set all fields
        if isinstance(obj, dict):
            data = obj.copy()
        else:
            data = {
                "id": obj.id,
                "name": obj.name,
                "attached_to_agent_id": obj.attached_to_agent_id,
                "message_count": obj.message_count,
                "last_message_at": obj.last_message_at,
                "created_at": obj.created_at,
                "updated_at": obj.updated_at,
            }

        data["attached_agent_ids"] = attached_agent_ids
        return super().model_validate(data, **kwargs)


class ConversationSessionWithMessagesResponse(ConversationSessionResponse):
    """Response model for a conversation session including messages."""

    messages: list[ConversationMessageResponse] = []


class ConversationSessionCreate(BaseModel):
    """Request model for creating a conversation session."""

    name: str | None = None  # If not provided, will be derived from first message
    first_message: str | None = None  # Optional initial message


class ConversationSessionUpdate(BaseModel):
    """Request model for updating a conversation session."""

    name: str | None = None


class AttachConversationRequest(BaseModel):
    """Request model for attaching a conversation to an agent."""

    agent_id: str


class DetachConversationRequest(BaseModel):
    """Request model for detaching a conversation from an agent."""

    agent_id: str | None = None  # If None, detach from all agents (backward compatibility)


class SendMessageRequest(BaseModel):
    """Request model for sending a message to a conversation."""

    role: str  # 'user' or 'assistant'
    content: str
    thinking: str | None = None
    tool_calls: dict[str, Any] | None = None
    tool_results: dict[str, Any] | None = None
    model: str | None = None
    stop_reason: str | None = None
    usage: dict[str, Any] | None = None
    input_type: str = "text"


# ============================================================================
# Helper Functions
# ============================================================================


def derive_session_name(first_message: str, max_length: int = 40) -> str:
    """Derive a conversation session name from the first message.

    Args:
        first_message: The content of the first message
        max_length: Maximum length of the derived name

    Returns:
        A truncated, cleaned version of the message suitable as a name
    """
    # Clean whitespace and newlines
    cleaned = first_message.strip().replace("\n", " ")

    # If short enough, return as-is
    if len(cleaned) <= max_length:
        return cleaned

    # Truncate at word boundary
    truncated = cleaned[:max_length]
    last_space = truncated.rfind(" ")

    if last_space > max_length // 2:  # Only use word boundary if reasonable
        truncated = truncated[:last_space]

    return truncated + "..."


async def verify_conversation_access(
    db: AsyncSession,
    session_id: str,
    conversation_id: str,
    request: Request,
) -> ConversationSession:
    """Verify user has access to a conversation and return it.

    Args:
        db: Database session
        session_id: Parent session ID
        conversation_id: Conversation ID to verify
        request: FastAPI request object

    Returns:
        The conversation session if access is granted

    Raises:
        HTTPException: If conversation not found or access denied
    """
    # First verify session access
    await verify_session_access(session_id, request, db)

    # Get the conversation
    result = await db.execute(
        select(ConversationSession)
        .options(
            selectinload(ConversationSession.messages),
            selectinload(ConversationSession.attached_agents),
        )
        .where(
            ConversationSession.id == conversation_id,
            ConversationSession.session_id == session_id,
        )
    )
    conversation = result.scalar_one_or_none()

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return conversation


# ============================================================================
# Routes
# ============================================================================


@router.get(
    "/sessions/{session_id}/conversations",
    response_model=list[ConversationSessionResponse],
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_conversations(
    request: Request,
    response: Response,  # noqa: ARG001
    session_id: str,
    db: DbSession,
    user_id: CurrentUserId,  # noqa: ARG001
) -> list[ConversationSessionResponse]:
    """List all conversation sessions for a workspace session.

    Args:
        req: FastAPI request object
        session_id: Parent session ID
        db: Database session
        user_id: Current user ID

    Returns:
        List of conversation sessions
    """
    await verify_session_access(session_id, request, db)

    result = await db.execute(
        select(ConversationSession)
        .options(selectinload(ConversationSession.attached_agents))
        .where(ConversationSession.session_id == session_id)
        .order_by(ConversationSession.last_message_at.desc().nullsfirst())
    )
    conversations = result.scalars().all()

    return [ConversationSessionResponse.model_validate(c) for c in conversations]


@router.post("/sessions/{session_id}/conversations", response_model=ConversationSessionResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_conversation(
    request: Request,
    response: Response,  # noqa: ARG001
    session_id: str,
    body: ConversationSessionCreate,
    db: DbSession,
    user_id: CurrentUserId,  # noqa: ARG001
) -> ConversationSessionResponse:
    """Create a new conversation session.

    If first_message is provided, it will be added and the name derived from it.
    Otherwise, a name must be provided.

    Args:
        req: FastAPI request object
        session_id: Parent session ID
        request: Creation request
        db: Database session
        user_id: Current user ID

    Returns:
        Created conversation session
    """
    await verify_session_access(session_id, request, db)

    # Determine name
    if body.first_message:
        name = derive_session_name(body.first_message)
    elif body.name:
        name = body.name
    else:
        name = "New Session"

    # Create conversation
    conversation = ConversationSession(
        session_id=session_id,
        name=name,
        message_count=0,
    )
    db.add(conversation)

    # Add first message if provided
    if body.first_message:
        message = ConversationMessage(
            conversation_session_id=conversation.id,
            role="user",
            content=body.first_message,
        )
        db.add(message)
        conversation.message_count = 1
        conversation.last_message_at = func.now()

    await db.commit()
    await db.refresh(conversation)

    # Emit WebSocket event for real-time sync
    await emit_to_session(
        session_id,
        "conversation_created",
        {
            "conversation": ConversationSessionResponse.model_validate(conversation).model_dump(
                mode="json"
            )
        },
    )

    logger.info("conversation_created", conversation_id=conversation.id, session_id=session_id)

    return ConversationSessionResponse.model_validate(conversation)


@router.get(
    "/sessions/{session_id}/conversations/{conversation_id}",
    response_model=ConversationSessionWithMessagesResponse,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_conversation(
    request: Request,
    response: Response,  # noqa: ARG001
    session_id: str,
    conversation_id: str,
    db: DbSession,
    user_id: CurrentUserId,  # noqa: ARG001
) -> ConversationSessionWithMessagesResponse:
    """Get a conversation session with all messages.

    Args:
        session_id: Parent session ID
        conversation_id: Conversation ID
        db: Database session
        user_id: Current user ID

    Returns:
        Conversation session with messages
    """
    conversation = await verify_conversation_access(db, session_id, conversation_id, request)

    return ConversationSessionWithMessagesResponse(
        id=conversation.id,
        name=conversation.name,
        attached_to_agent_id=conversation.attached_to_agent_id,
        message_count=conversation.message_count,
        last_message_at=conversation.last_message_at,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=[ConversationMessageResponse.model_validate(m) for m in conversation.messages],
    )


@router.patch(
    "/sessions/{session_id}/conversations/{conversation_id}",
    response_model=ConversationSessionResponse,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_conversation(
    request: Request,
    response: Response,  # noqa: ARG001
    session_id: str,
    conversation_id: str,
    body: ConversationSessionUpdate,
    db: DbSession,
    user_id: CurrentUserId,  # noqa: ARG001
) -> ConversationSessionResponse:
    """Update a conversation session (e.g., rename).

    Args:
        session_id: Parent session ID
        conversation_id: Conversation ID
        request: Update request
        db: Database session
        user_id: Current user ID

    Returns:
        Updated conversation session
    """
    conversation = await verify_conversation_access(db, session_id, conversation_id, request)

    if body.name is not None:
        conversation.name = body.name

    await db.commit()
    await db.refresh(conversation)

    # Emit WebSocket event
    await emit_to_session(
        session_id,
        "conversation_updated",
        {"conversation": ConversationSessionResponse.model_validate(conversation).model_dump()},
    )

    return ConversationSessionResponse.model_validate(conversation)


@router.delete("/sessions/{session_id}/conversations/{conversation_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_conversation(
    request: Request,
    response: Response,  # noqa: ARG001
    session_id: str,
    conversation_id: str,
    db: DbSession,
    user_id: CurrentUserId,  # noqa: ARG001
) -> dict[str, str]:
    """Delete a conversation session and all its messages.

    Args:
        session_id: Parent session ID
        conversation_id: Conversation ID
        db: Database session
        user_id: Current user ID

    Returns:
        Success message
    """
    conversation = await verify_conversation_access(db, session_id, conversation_id, request)

    await db.delete(conversation)
    await db.commit()

    # Emit WebSocket event
    await emit_to_session(
        session_id,
        "conversation_deleted",
        {"conversation_id": conversation_id},
    )

    logger.info("conversation_deleted", conversation_id=conversation_id, session_id=session_id)

    return {"status": "deleted"}


@router.post(
    "/sessions/{session_id}/conversations/{conversation_id}/attach",
    response_model=ConversationSessionResponse,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def attach_conversation(
    request: Request,
    response: Response,  # noqa: ARG001
    session_id: str,
    conversation_id: str,
    body: AttachConversationRequest,
    db: DbSession,
    user_id: CurrentUserId,  # noqa: ARG001
) -> ConversationSessionResponse:
    """Attach a conversation to an agent.

    A conversation can only be attached to one agent at a time (exclusive).
    If the conversation is already attached to another agent, this will fail.

    Args:
        session_id: Parent session ID
        conversation_id: Conversation ID
        request: Attach request with agent_id
        db: Database session
        user_id: Current user ID

    Returns:
        Updated conversation session

    Raises:
        HTTPException: If conversation is already attached to another agent
    """
    conversation = await verify_conversation_access(db, session_id, conversation_id, request)

    # Verify the agent exists and belongs to this session
    result = await db.execute(
        select(AgentModel).where(
            AgentModel.id == body.agent_id,
            AgentModel.session_id == session_id,
        )
    )
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in this session")

    # Load attached agents relationship
    await db.refresh(conversation, ["attached_agents"])

    # Check if already attached to this agent (idempotent)
    if agent in conversation.attached_agents:
        # Already attached, just return success
        await db.refresh(conversation, ["attached_agents"])
        return ConversationSessionResponse.model_validate(conversation)

    # Add to many-to-many relationship
    conversation.attached_agents.append(agent)

    # Also update legacy field for backward compatibility (set to first attached agent)
    if not conversation.attached_to_agent_id:
        conversation.attached_to_agent_id = body.agent_id

    await db.commit()
    await db.refresh(conversation)

    # Emit WebSocket event
    await emit_to_session(
        session_id,
        "conversation_attached",
        {
            "conversation_id": conversation_id,
            "agent_id": body.agent_id,
        },
    )

    logger.info(
        "conversation_attached",
        conversation_id=conversation_id,
        agent_id=body.agent_id,
        session_id=session_id,
    )

    return ConversationSessionResponse.model_validate(conversation)


@router.post(
    "/sessions/{session_id}/conversations/{conversation_id}/detach",
    response_model=ConversationSessionResponse,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def detach_conversation(
    request: Request,
    response: Response,  # noqa: ARG001
    session_id: str,
    conversation_id: str,
    body: DetachConversationRequest,
    db: DbSession,
    user_id: CurrentUserId,  # noqa: ARG001
) -> ConversationSessionResponse:
    """Detach a conversation from an agent (or all agents if agent_id not provided).

    Args:
        session_id: Parent session ID
        conversation_id: Conversation ID
        body: Detach request with optional agent_id
        db: Database session
        user_id: Current user ID

    Returns:
        Updated conversation session
    """
    conversation = await verify_conversation_access(db, session_id, conversation_id, request)

    # Load attached agents
    await db.refresh(conversation, ["attached_agents"])

    old_agent_id: str | None
    if body.agent_id:
        # Detach from specific agent
        agent_result = await db.execute(
            select(AgentModel).where(
                AgentModel.id == body.agent_id,
                AgentModel.session_id == session_id,
            )
        )
        agent = agent_result.scalar_one_or_none()
        if agent and agent in conversation.attached_agents:
            conversation.attached_agents.remove(agent)
            # Update legacy field if this was the only agent or if it matched
            if conversation.attached_to_agent_id == body.agent_id:
                conversation.attached_to_agent_id = (
                    conversation.attached_agents[0].id if conversation.attached_agents else None
                )
            old_agent_id = body.agent_id
        else:
            # Agent not found or not attached, return as-is
            await db.refresh(conversation)
            return ConversationSessionResponse.model_validate(conversation)
    else:
        # Detach from all agents (backward compatibility)
        old_agent_id = conversation.attached_to_agent_id
        conversation.attached_agents.clear()
        conversation.attached_to_agent_id = None

    await db.commit()
    await db.refresh(conversation)

    # Emit WebSocket event
    await emit_to_session(
        session_id,
        "conversation_detached",
        {
            "conversation_id": conversation_id,
            "previous_agent_id": old_agent_id,
        },
    )

    logger.info(
        "conversation_detached",
        conversation_id=conversation_id,
        previous_agent_id=old_agent_id,
        session_id=session_id,
    )

    return ConversationSessionResponse.model_validate(conversation)


@router.post(
    "/sessions/{session_id}/conversations/{conversation_id}/messages",
    response_model=ConversationMessageResponse,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def add_message(
    request: Request,
    response: Response,  # noqa: ARG001
    session_id: str,
    conversation_id: str,
    body: SendMessageRequest,
    db: DbSession,
    user_id: CurrentUserId,  # noqa: ARG001
) -> ConversationMessageResponse:
    """Add a message to a conversation.

    Args:
        session_id: Parent session ID
        conversation_id: Conversation ID
        request: Message data
        db: Database session
        user_id: Current user ID

    Returns:
        Created message
    """
    conversation = await verify_conversation_access(db, session_id, conversation_id, request)

    # Create message
    message = ConversationMessage(
        conversation_session_id=conversation_id,
        role=body.role,
        content=body.content,
        thinking=body.thinking,
        tool_calls=body.tool_calls,
        tool_results=body.tool_results,
        model=body.model,
        stop_reason=body.stop_reason,
        usage=body.usage,
        input_type=body.input_type,
    )
    db.add(message)

    # Update conversation metadata
    conversation.message_count += 1
    conversation.last_message_at = func.now()

    # Update name from first message if it was "New Session"
    if conversation.message_count == 1 and conversation.name == "New Session":
        conversation.name = derive_session_name(body.content)

    await db.commit()
    await db.refresh(message)
    await db.refresh(conversation)

    # Emit WebSocket event
    await emit_to_session(
        session_id,
        "conversation_message",
        {
            "conversation_id": conversation_id,
            "message": ConversationMessageResponse.model_validate(message).model_dump(),
        },
    )

    return ConversationMessageResponse.model_validate(message)


@router.get(
    "/sessions/{session_id}/conversations/{conversation_id}/messages",
    response_model=list[ConversationMessageResponse],
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_messages(
    request: Request,
    response: Response,  # noqa: ARG001
    session_id: str,
    conversation_id: str,
    db: DbSession,
    user_id: CurrentUserId,  # noqa: ARG001
    limit: int = 100,
    offset: int = 0,
) -> list[ConversationMessageResponse]:
    """List messages in a conversation with pagination.

    Args:
        session_id: Parent session ID
        conversation_id: Conversation ID
        db: Database session
        user_id: Current user ID
        limit: Maximum messages to return
        offset: Number of messages to skip

    Returns:
        List of messages
    """
    await verify_conversation_access(db, session_id, conversation_id, request)

    result = await db.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_session_id == conversation_id)
        .order_by(ConversationMessage.created_at)
        .limit(limit)
        .offset(offset)
    )
    messages = result.scalars().all()

    return [ConversationMessageResponse.model_validate(m) for m in messages]
