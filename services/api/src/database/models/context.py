"""Context management models: ConversationSummary, Memory, Compaction."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _generate_uuid


class ConversationSummary(Base):
    """Conversation summary for context management."""

    __tablename__ = "conversation_summaries"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    agent_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        index=True,
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    messages_start_index: Mapped[int] = mapped_column(Integer, nullable=False)
    messages_end_index: Mapped[int] = mapped_column(Integer, nullable=False)
    original_token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    summary_token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    compression_ratio: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )


class Memory(Base):
    """Memory storage for knowledge base."""

    __tablename__ = "memories"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    memory_type: Mapped[str] = mapped_column(String(50), default="fact", nullable=False, index=True)
    tags: Mapped[list[str] | None] = mapped_column(JSONB)
    memory_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    importance: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    source_message_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class ContextCompactionSettings(Base):
    """User/session context compaction settings."""

    __tablename__ = "context_compaction_settings"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        index=True,
    )
    auto_compact_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auto_compact_threshold_percent: Mapped[int] = mapped_column(Integer, default=80, nullable=False)
    custom_compaction_instructions: Mapped[str | None] = mapped_column(Text)
    preserve_recent_messages: Mapped[int] = mapped_column(Integer, default=15, nullable=False)
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

    # Unique constraint: one settings per user+session combo
    __table_args__ = (
        UniqueConstraint("user_id", "session_id", name="uq_compaction_settings_user_session"),
    )


class UserSkill(Base):
    """User-created skill that can be executed by agents."""

    __tablename__ = "user_skills"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(String(20), default="1.0.0", nullable=False)
    triggers: Mapped[list[str] | None] = mapped_column(JSONB)
    tags: Mapped[list[str] | None] = mapped_column(JSONB)
    required_tools: Mapped[list[str] | None] = mapped_column(JSONB)
    steps: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    system_prompt: Mapped[str | None] = mapped_column(Text)
    generated_by_agent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source_conversation_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
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

    # Unique constraint: one skill name per user
    __table_args__ = (UniqueConstraint("user_id", "slug", name="uq_user_skills_user_slug"),)


class CompactionLog(Base):
    """Log of context compaction events."""

    __tablename__ = "compaction_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    agent_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tokens_before: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_after: Mapped[int] = mapped_column(Integer, nullable=False)
    messages_removed: Mapped[int] = mapped_column(Integer, nullable=False)
    messages_preserved: Mapped[int] = mapped_column(Integer, nullable=False)
    summary_text: Mapped[str | None] = mapped_column(Text)
    trigger_type: Mapped[str] = mapped_column(String(20), nullable=False)  # auto, manual, threshold
    custom_instructions: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
