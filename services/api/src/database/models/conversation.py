"""Conversation models: ConversationSession and ConversationMessage.

These models decouple conversations from agents, allowing conversations to be
portable and attachable to any agent card.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Table, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, _generate_uuid

if TYPE_CHECKING:
    from .core import Agent, Session

# Junction table for many-to-many relationship between agents and conversations
agent_conversation_attachments = Table(
    "agent_conversation_attachments",
    Base.metadata,
    Column(
        "agent_id",
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "conversation_session_id",
        UUID(as_uuid=False),
        ForeignKey("conversation_sessions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class ConversationSession(Base):
    """Portable conversation session that can be attached to any agent.

    A conversation session holds the message history and can be attached
    to multiple agent cards simultaneously (many-to-many relationship).
    """

    __tablename__ = "conversation_sessions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Legacy field for backward compatibility - kept for migration period
    # Use attached_agents relationship instead
    attached_to_agent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="SET NULL"),
        index=True,
    )

    # Metadata for display
    message_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    session: Mapped["Session"] = relationship("Session", back_populates="conversation_sessions")
    messages: Mapped[list["ConversationMessage"]] = relationship(
        "ConversationMessage",
        back_populates="conversation_session",
        cascade="all, delete-orphan",
        order_by="ConversationMessage.created_at",
    )
    # Legacy relationship for backward compatibility
    attached_agent: Mapped["Agent | None"] = relationship(
        "Agent",
        back_populates="conversation_session",
        foreign_keys=[attached_to_agent_id],
    )
    # Many-to-many relationship: agents that have this conversation attached
    attached_agents: Mapped[list["Agent"]] = relationship(
        "Agent",
        secondary=agent_conversation_attachments,
        back_populates="attached_conversations",
    )


class ConversationMessage(Base):
    """Message within a conversation session."""

    __tablename__ = "conversation_messages"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    conversation_session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("conversation_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Message content
    role: Mapped[str] = mapped_column(String(50), nullable=False)  # 'user' | 'assistant'
    content: Mapped[str] = mapped_column(Text, nullable=False)
    thinking: Mapped[str | None] = mapped_column(Text)  # Agent's reasoning (for extended thinking)

    # Tool usage
    tool_calls: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    tool_results: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Model metadata
    model: Mapped[str | None] = mapped_column(String(100))
    stop_reason: Mapped[str | None] = mapped_column(String(50))
    usage: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # Token counts

    # Voice/audio fields (preserved from original Message model)
    audio_url: Mapped[str | None] = mapped_column(Text)  # S3 URL for audio
    audio_duration_ms: Mapped[int | None] = mapped_column(Integer)
    input_type: Mapped[str] = mapped_column(String(20), default="text")  # "text" or "voice"
    transcription_confidence: Mapped[float | None] = mapped_column(Float)
    tts_summary: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Relationships
    conversation_session: Mapped["ConversationSession"] = relationship(
        "ConversationSession",
        back_populates="messages",
    )
