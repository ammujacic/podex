"""Agent configuration models."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database.encrypted_types import EncryptedJSON

from .base import Base, _generate_uuid

if TYPE_CHECKING:
    from .core import Agent, User


class AgentTemplate(Base):
    """Custom agent template model for reusable agent definitions."""

    __tablename__ = "agent_templates"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(50))  # Emoji or icon name

    # Agent configuration
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    allowed_tools: Mapped[list[str]] = mapped_column(JSONB, nullable=False)  # List of tool names
    model: Mapped[str] = mapped_column(String(100), default="claude-sonnet-4-20250514")
    temperature: Mapped[float | None] = mapped_column(Float)  # None means provider default
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

    # Unique constraint: user can't have duplicate slugs
    __table_args__ = (UniqueConstraint("user_id", "slug", name="uq_agent_templates_user_slug"),)


class TerminalIntegratedAgentType(Base):
    """Admin-configurable terminal-integrated agent types."""

    __tablename__ = "terminal_integrated_agent_types"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    logo_url: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)

    # Command definitions (stored as JSON arrays of strings)
    check_installed_command: Mapped[list[str] | None] = mapped_column(JSONB)
    version_command: Mapped[list[str] | None] = mapped_column(JSONB)
    install_command: Mapped[list[str] | None] = mapped_column(JSONB)
    update_command: Mapped[list[str] | None] = mapped_column(JSONB)
    run_command: Mapped[list[str]] = mapped_column(JSONB, nullable=False)

    # Optional suggested environment variables (keys only)
    default_env_template: Mapped[dict[str, str] | None] = mapped_column(JSONB)

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_admin_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
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

    # Relationships
    created_by_admin: Mapped["User | None"] = relationship("User")
    sessions: Mapped[list["TerminalAgentSession"]] = relationship(
        "TerminalAgentSession",
        back_populates="agent_type",
        cascade="all, delete-orphan",
    )
    env_profiles: Mapped[list["ExternalAgentEnvProfile"]] = relationship(
        "ExternalAgentEnvProfile",
        back_populates="agent_type",
        cascade="all, delete-orphan",
    )


class TerminalAgentSession(Base):
    """Active terminal-integrated agent sessions."""

    __tablename__ = "terminal_agent_sessions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[str] = mapped_column(
        String(255),  # Compute service workspace ID
        nullable=False,
        index=True,
    )
    agent_type_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("terminal_integrated_agent_types.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    env_profile_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("external_agent_env_profiles.id", ondelete="SET NULL"),
    )
    status: Mapped[str] = mapped_column(
        String(20), default="starting", nullable=False
    )  # starting, running, installing, exited, error
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    last_heartbeat_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User")
    agent_type: Mapped["TerminalIntegratedAgentType"] = relationship(
        "TerminalIntegratedAgentType",
        back_populates="sessions",
    )
    env_profile: Mapped["ExternalAgentEnvProfile | None"] = relationship(
        "ExternalAgentEnvProfile",
        back_populates="sessions",
    )


class ExternalAgentEnvProfile(Base):
    """User-managed environment profiles for external agents."""

    __tablename__ = "external_agent_env_profiles"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    # org_id reserved for future organization support (no FK until organizations table exists)
    org_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    agent_type_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("terminal_integrated_agent_types.id", ondelete="CASCADE"),
    )
    # Environment variables stored encrypted at rest for security
    env_vars: Mapped[dict[str, str]] = mapped_column(EncryptedJSON, nullable=False)
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
    user: Mapped["User | None"] = relationship("User")
    agent_type: Mapped["TerminalIntegratedAgentType | None"] = relationship(
        "TerminalIntegratedAgentType",
        back_populates="env_profiles",
    )
    sessions: Mapped[list["TerminalAgentSession"]] = relationship(
        "TerminalAgentSession",
        back_populates="env_profile",
    )


class Subagent(Base):
    """Subagent tracking for context isolation."""

    __tablename__ = "subagents"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    parent_agent_id: Mapped[str] = mapped_column(
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
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    system_prompt: Mapped[str | None] = mapped_column(Text)
    tools: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="spawned", nullable=False
    )  # spawned, running, completed, failed
    blocking: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)  # Summary returned to parent
    verbose_output: Mapped[str | None] = mapped_column(Text)  # Full output (not returned to parent)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentTool(Base):
    """Registry of available tools that can be assigned to agents.

    This is the single source of truth for all tool definitions including:
    - Tool name and description
    - JSON Schema parameters
    - Tool category and metadata

    Tools are referenced by name in AgentRoleConfig.tools.
    Admins can customize these via the admin panel.
    """

    __tablename__ = "agent_tools"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    parameters: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False
    )  # JSON Schema for tool parameters
    category: Mapped[str] = mapped_column(
        String(50), default="general", nullable=False
    )  # file, git, delegation, etc.

    # Ordering and visibility
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_system: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )  # System tools can't be deleted

    # Audit
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


class AgentRoleConfig(Base):
    """Admin-configurable default configurations for agent roles.

    This is the single source of truth for agent role defaults including:
    - Display name and color
    - System prompt
    - Default tools (references AgentTool by name)
    - Default model settings

    Admins can customize these via the admin panel.
    Frontend fetches these from the API instead of hardcoding.
    """

    __tablename__ = "agent_role_configs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    role: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(50), nullable=False)  # cyan, purple, green, etc.
    icon: Mapped[str | None] = mapped_column(String(50))  # Optional icon name or emoji
    description: Mapped[str | None] = mapped_column(Text)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    tools: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False
    )  # Tool names referencing AgentTool.name

    # Display/UI fields (fetched by frontend instead of hardcoding)
    category: Mapped[str] = mapped_column(
        String(50), default="development", nullable=False
    )  # development, terminal, system, custom
    gradient_start: Mapped[str | None] = mapped_column(String(20))  # Start color for UI gradients
    gradient_end: Mapped[str | None] = mapped_column(String(20))  # End color for UI gradients
    features: Mapped[list[str] | None] = mapped_column(JSONB)  # Feature highlights for UI
    example_prompts: Mapped[list[str] | None] = mapped_column(
        JSONB
    )  # Example prompts for this role
    requires_subscription: Mapped[str | None] = mapped_column(
        String(50)
    )  # Minimum plan slug required (null = available to all)

    # Default model settings (can be overridden per-user in preferences)
    default_model: Mapped[str | None] = mapped_column(String(100))  # Falls back to platform default
    default_temperature: Mapped[float | None] = mapped_column(Float)
    default_max_tokens: Mapped[int | None] = mapped_column(Integer)

    # Ordering and visibility
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_system: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )  # System roles can't be deleted

    # Audit
    created_by_admin_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
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

    # Relationships
    created_by_admin: Mapped["User | None"] = relationship("User")

    # Usage stats (updated via API)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentWorktree(Base):
    """Git worktree tracking for parallel agent execution."""

    __tablename__ = "agent_worktrees"

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
    worktree_path: Mapped[str] = mapped_column(Text, nullable=False)
    branch_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="active", nullable=False
    )  # active, merging, merged, conflict
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    merged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
