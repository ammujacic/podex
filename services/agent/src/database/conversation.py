"""Conversation persistence service for agent conversations."""

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import structlog
from sqlalchemy import func as sqlfunc
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import Agent, Message

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
    """Load conversation history for an agent from the database.

    Args:
        db: Database session
        agent_id: Agent ID to load history for
        limit: Maximum number of messages to load

    Returns:
        List of message dicts with 'role' and 'content' keys
    """
    result = await db.execute(
        select(Message)
        .where(Message.agent_id == agent_id)
        .order_by(Message.created_at.desc())
        .limit(limit),
    )
    messages = result.scalars().all()

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
) -> Message:
    """Save a message to the database.

    Args:
        db: Database session
        agent_id: Agent ID this message belongs to
        message_data: Message data containing role, content, and optional fields

    Returns:
        The created Message object

    Note:
        This function commits the transaction immediately to ensure
        messages are persisted even if subsequent operations fail.
    """
    message = Message(
        id=str(uuid4()),
        agent_id=agent_id,
        role=message_data.role,
        content=message_data.content,
        tool_calls=message_data.tool_calls,
        tokens_used=message_data.tokens_used,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    logger.debug("Saved message", agent_id=agent_id, role=message_data.role, message_id=message.id)
    return message


async def save_user_message(
    db: AsyncSession,
    agent_id: str,
    content: str,
) -> Message:
    """Save a user message to the database."""
    return await save_message(db, agent_id, MessageData(role="user", content=content))


async def save_assistant_message(
    db: AsyncSession,
    agent_id: str,
    content: str,
    tool_calls: dict[str, Any] | None = None,
    tokens_used: int | None = None,
) -> Message:
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
    result = await db.execute(
        select(
            sqlfunc.count(Message.id).label("msg_count"),
            sqlfunc.min(Message.created_at).label("first"),
            sqlfunc.max(Message.created_at).label("last"),
        ).where(Message.agent_id == agent_id),
    )
    row = result.one()

    return {
        "message_count": row.msg_count or 0,
        "first_message_at": row.first,
        "last_message_at": row.last,
    }
