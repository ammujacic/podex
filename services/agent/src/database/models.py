"""SQLAlchemy models for agent service (mirrors API service models)."""

from datetime import datetime
from typing import Any, ClassVar
from uuid import uuid4

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
    quoted_name,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models."""

    type_annotation_map: ClassVar[dict[type, type]] = {
        dict[str, Any]: JSONB,
        list[str]: JSONB,
    }


class User(Base):
    """User model."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    oauth_provider: Mapped[str | None] = mapped_column(String(50))
    oauth_id: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
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

    sessions: Mapped[list["Session"]] = relationship("Session", back_populates="owner")


class Session(Base):
    """Development session model."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    workspace_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspaces.id", ondelete="SET NULL"),
    )
    git_url: Mapped[str | None] = mapped_column(Text)
    branch: Mapped[str] = mapped_column(String(255), default="main")
    status: Mapped[str] = mapped_column(String(50), default="active")
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
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

    owner: Mapped["User"] = relationship("User", back_populates="sessions")
    workspace: Mapped["Workspace | None"] = relationship("Workspace", back_populates="session")
    agents: Mapped[list["Agent"]] = relationship("Agent", back_populates="session")


class Agent(Base):
    """AI agent model."""

    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="idle")
    # Agent mode: plan, ask, auto, sovereign
    # Note: "mode" is a reserved keyword in PostgreSQL (ordered-set aggregate function),
    # so we use quoted_name to ensure it's always quoted in SQL queries
    mode: Mapped[str] = mapped_column(
        quoted_name("mode", True), String(20), default="ask", nullable=False
    )
    # Previous mode for auto-revert functionality
    # When an agent auto-switches modes, this stores the original mode to revert to
    previous_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Allowed terminal commands for Auto mode (glob patterns)
    command_allowlist: Mapped[list[str] | None] = mapped_column(JSONB)
    config: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Reference to custom agent template (for custom agents)
    template_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agent_templates.id", ondelete="SET NULL"),
    )
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

    session: Mapped["Session"] = relationship("Session", back_populates="agents")
    messages: Mapped[list["Message"]] = relationship(
        "Message",
        back_populates="agent",
        order_by="Message.created_at",
    )
    template: Mapped["AgentTemplate | None"] = relationship(
        "AgentTemplate",
        back_populates="agents",
    )


class Message(Base):
    """Agent conversation message model."""

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    agent_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(50), nullable=False)  # user, assistant, system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_calls: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    tokens_used: Mapped[int | None] = mapped_column()
    # Voice/audio fields (must match API service model)
    audio_url: Mapped[str | None] = mapped_column(Text)
    audio_duration_ms: Mapped[int | None] = mapped_column(Integer)
    input_type: Mapped[str] = mapped_column(String(20), default="text")  # "text" or "voice"
    transcription_confidence: Mapped[float | None] = mapped_column(Float)
    tts_summary: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    agent: Mapped["Agent"] = relationship("Agent", back_populates="messages")


class Workspace(Base):
    """Workspace model for compute environments."""

    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    container_id: Mapped[str | None] = mapped_column(String(255))
    s3_bucket: Mapped[str | None] = mapped_column(String(255))
    s3_prefix: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="pending")
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

    session: Mapped["Session | None"] = relationship("Session", back_populates="workspace")


class AgentTemplate(Base):
    """Custom agent template model for reusable agent definitions."""

    __tablename__ = "agent_templates"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(50))

    # Agent configuration
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    allowed_tools: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    model: Mapped[str] = mapped_column(String(100), default="claude-sonnet-4-20250514")
    temperature: Mapped[float | None] = mapped_column(Float)
    max_tokens: Mapped[int | None] = mapped_column(Integer)

    # Additional config (extensible)
    config: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Visibility and sharing
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    share_token: Mapped[str | None] = mapped_column(
        String(32),
        unique=True,
        index=True,
    )  # Unique token for sharing links

    # Stats
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    clone_count: Mapped[int] = mapped_column(Integer, default=0)  # How many times this was cloned

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
    owner: Mapped["User"] = relationship("User")
    agents: Mapped[list["Agent"]] = relationship("Agent", back_populates="template")

    # Unique constraint
    __table_args__ = (UniqueConstraint("user_id", "slug", name="uq_agent_templates_user_slug"),)
