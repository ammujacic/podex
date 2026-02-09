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
    # Default to Claude Sonnet 4.5, the platform's balanced model
    model: Mapped[str] = mapped_column(String(100), default="claude-sonnet-4.5")
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

    # Permission type flags - used for mode-based access control
    # These determine how each tool behaves in different agent modes:
    # - Plan mode: only is_read_operation=True allowed
    # - Ask mode: requires approval for write/command/deploy operations
    # - Auto mode: writes allowed, commands need allowlist, deploys need approval
    # - Sovereign mode: everything allowed
    is_read_operation: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )  # Read-only operations (allowed in Plan mode)
    is_write_operation: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )  # Modifies files (write_file, apply_patch)
    is_command_operation: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )  # Executes shell commands (run_command)
    is_deploy_operation: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )  # Deployment operations (deploy_preview, etc.)

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
