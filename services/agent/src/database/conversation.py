"""Conversation persistence service for agent conversations."""

from dataclasses import dataclass
from typing import Any, cast
from uuid import uuid4

import structlog
from sqlalchemy import func as sqlfunc
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.database.models import Agent, ConversationMessage, ConversationSession

logger = structlog.get_logger()


@dataclass
class MessageData:
    """Data for a message to be saved."""

    role: str
    content: str
    tool_calls: dict[str, Any] | None = None
    tokens_used: int | None = None


async def load_conversation_history(
    db: AsyncSession,
    agent_id: str,
    limit: int = 50,
) -> list[dict[str, str]]:
    """Load conversation history for an agent from its attached conversation session.

    Args:
        db: Database session
        agent_id: Agent ID to load history for
        limit: Maximum number of messages to load

    Returns:
        List of message dicts with 'role' and 'content' keys
    """
    # Get the agent with its conversation session
    result = await db.execute(
        select(Agent).options(selectinload(Agent.conversation_session)).where(Agent.id == agent_id)
    )
    agent = result.scalar_one_or_none()

    if not agent or not agent.conversation_session:
        logger.info("No conversation session for agent", agent_id=agent_id)
        return []

    # Load messages from the conversation session
    messages_result = await db.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_session_id == agent.conversation_session.id)
        .order_by(ConversationMessage.created_at.desc())
        .limit(limit),
    )
    messages = messages_result.scalars().all()

    # Reverse to get chronological order
    history = []
    for msg in reversed(messages):
        history.append(
            {
                "role": msg.role,
                "content": msg.content,
            },
        )

    logger.info("Loaded conversation history", agent_id=agent_id, message_count=len(history))
    return history


async def save_message(
    db: AsyncSession,
    agent_id: str,
    message_data: MessageData,
) -> ConversationMessage:
    """Save a message to the agent's conversation session.

    If the agent doesn't have a conversation session attached, one will be created.

    Args:
        db: Database session
        agent_id: Agent ID this message belongs to
        message_data: Message data containing role, content, and optional fields

    Returns:
        The created ConversationMessage object
    """
    # Get the agent with its conversation session
    result = await db.execute(
        select(Agent).options(selectinload(Agent.conversation_session)).where(Agent.id == agent_id)
    )
    agent = result.scalar_one_or_none()

    if not agent:
        raise ValueError(f"Agent {agent_id} not found")

    # Get or create conversation session
    conversation_session_id = None
    if agent.conversation_session:
        conversation_session_id = agent.conversation_session.id
    else:
        # Create a new conversation session attached to this agent
        conversation = ConversationSession(
            id=str(uuid4()),
            session_id=agent.session_id,
            name="New Session",
            attached_to_agent_id=agent_id,
        )
        db.add(conversation)
        await db.flush()
        conversation_session_id = conversation.id

    message = ConversationMessage(
        id=str(uuid4()),
        conversation_session_id=conversation_session_id,
        role=message_data.role,
        content=message_data.content,
        tool_calls=message_data.tool_calls,
        usage={"tokens_used": message_data.tokens_used} if message_data.tokens_used else None,
    )
    db.add(message)

    # Update conversation metadata
    conv_result = await db.execute(
        select(ConversationSession).where(ConversationSession.id == conversation_session_id)
    )
    conversation = cast("ConversationSession", conv_result.scalar_one_or_none())
    conversation.message_count += 1
    conversation.last_message_at = sqlfunc.now()

    await db.commit()
    await db.refresh(message)

    logger.debug("Saved message", agent_id=agent_id, role=message_data.role, message_id=message.id)
    return message


async def save_user_message(
    db: AsyncSession,
    agent_id: str,
    content: str,
) -> ConversationMessage:
    """Save a user message to the database."""
    return await save_message(db, agent_id, MessageData(role="user", content=content))


async def save_assistant_message(
    db: AsyncSession,
    agent_id: str,
    content: str,
    tool_calls: dict[str, Any] | None = None,
    tokens_used: int | None = None,
) -> ConversationMessage:
    """Save an assistant message to the database."""
    message_data = MessageData(
        role="assistant",
        content=content,
        tool_calls=tool_calls,
        tokens_used=tokens_used,
    )
    return await save_message(db, agent_id, message_data)


async def update_agent_status(
    db: AsyncSession,
    agent_id: str,
    status: str,
) -> None:
    """Update the agent's status in the database.

    Args:
        db: Database session
        agent_id: Agent ID to update
        status: New status ('idle', 'active', 'error')
    """
    await db.execute(update(Agent).where(Agent.id == agent_id).values(status=status))
    logger.debug("Updated agent status", agent_id=agent_id, status=status)


async def get_agent_info(
    db: AsyncSession,
    agent_id: str,
) -> Agent | None:
    """Get agent information from the database.

    Args:
        db: Database session
        agent_id: Agent ID to look up

    Returns:
        Agent object or None if not found
    """
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    return result.scalar_one_or_none()


async def get_conversation_summary(
    db: AsyncSession,
    agent_id: str,
) -> dict[str, Any]:
    """Get a summary of an agent's conversation.

    Args:
        db: Database session
        agent_id: Agent ID

    Returns:
        Dict with message_count, first_message_at, last_message_at
    """
    # Get the agent's conversation session
    result = await db.execute(
        select(Agent).options(selectinload(Agent.conversation_session)).where(Agent.id == agent_id)
    )
    agent = result.scalar_one_or_none()

    if not agent or not agent.conversation_session:
        return {
            "message_count": 0,
            "first_message_at": None,
            "last_message_at": None,
        }

    messages_result = await db.execute(
        select(
            sqlfunc.count(ConversationMessage.id).label("msg_count"),
            sqlfunc.min(ConversationMessage.created_at).label("first"),
            sqlfunc.max(ConversationMessage.created_at).label("last"),
        ).where(ConversationMessage.conversation_session_id == agent.conversation_session.id),
    )
    row = messages_result.one()

    return {
        "message_count": row.msg_count or 0,
        "first_message_at": row.first,
        "last_message_at": row.last,
    }
