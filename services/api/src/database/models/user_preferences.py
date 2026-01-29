"""User preferences and configuration models."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database.encrypted_types import EncryptedJSON, EncryptedString

from .base import Base, _generate_uuid

if TYPE_CHECKING:
    from .core import Session, User


class UserConfig(Base):
    """User configuration model."""

    __tablename__ = "user_configs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Default shell and editor
    default_shell: Mapped[str] = mapped_column(String(50), default="zsh")
    default_editor: Mapped[str] = mapped_column(String(50), default="vscode")

    # Git configuration (synced to workspaces)
    git_name: Mapped[str | None] = mapped_column(String(255))
    git_email: Mapped[str | None] = mapped_column(String(255))

    # Default pod template
    default_template_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("pod_templates.id", ondelete="SET NULL"),
    )

    # Theme preferences
    theme: Mapped[str] = mapped_column(String(50), default="dark")
    editor_theme: Mapped[str] = mapped_column(String(100), default="vs-dark")

    # Completed onboarding tours (for cross-device persistence)
    completed_tours: Mapped[list[str] | None] = mapped_column(JSONB, default=list)

    # Pod standby configuration (None = Never auto-standby)
    default_standby_timeout_minutes: Mapped[int | None] = mapped_column(
        Integer, default=60, nullable=True
    )

    # User preferences - synced across devices
    custom_keybindings: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, default=dict
    )  # Custom keybinding overrides
    editor_settings: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, default=dict
    )  # Editor preferences (font, tabs, etc.)
    ui_preferences: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, default=dict
    )  # UI layout, sidebar, theme, etc.
    voice_preferences: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, default=dict
    )  # Voice/TTS/STT settings
    agent_preferences: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, default=dict
    )  # Agent configs and settings (no API keys)

    # User-provided API keys for external LLM providers (stored encrypted)
    # Format: openai: sk-..., anthropic: sk-ant-..., google: ...
    llm_api_keys: Mapped[dict[str, str] | None] = mapped_column(EncryptedJSON)

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


class UserHook(Base):
    """User-defined hooks for agent lifecycle events."""

    __tablename__ = "user_hooks"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    hook_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # pre_tool_call, post_tool_call, pre_compact, session_start, subagent_stop
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(
        Integer, default=100, nullable=False
    )  # Lower = runs first
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False
    )  # code, tool_name, tool_args, prompt_addition, filters
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


class CustomCommand(Base):
    """User-defined custom commands (slash commands) for agents.

    Commands can be simple prompt templates or complex workflows with
    argument placeholders. They can be scoped to user, session, or global.
    """

    __tablename__ = "custom_commands"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        index=True,
    )
    # Command name (without slash), e.g., "review", "test", "deploy"
    name: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Short description shown in command palette
    description: Mapped[str | None] = mapped_column(String(255))
    # Full prompt template with optional placeholders like {{file}} or {{selection}}
    prompt_template: Mapped[str] = mapped_column(Text, nullable=False)
    # Argument definitions: [{name, type, required, default, description}]
    arguments: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    # Category for grouping in UI: "code", "git", "test", "deploy", "custom"
    category: Mapped[str] = mapped_column(String(50), default="custom", nullable=False)
    # Whether this command is enabled
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Sort order for display
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    # Whether command is global (admin-defined for all users)
    is_global: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Usage count for analytics
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

    # Relationships
    user: Mapped["User | None"] = relationship("User")
    session: Mapped["Session | None"] = relationship("Session")

    # Unique constraint: command name is unique per user (or global)
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_custom_command_user_name"),)


class UserOAuthToken(Base):
    """OAuth tokens for LLM provider personal plans.

    Stores OAuth credentials for providers that support personal plan authentication
    (e.g., Anthropic Claude Pro/Max, Google Gemini, GitHub Copilot/Codex).

    Tokens are encrypted at rest and auto-refreshed when expired.
    """

    __tablename__ = "user_oauth_tokens"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Provider identifier: "anthropic", "google", "github"
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # OAuth tokens (encrypted at rest)
    access_token: Mapped[str] = mapped_column(EncryptedString, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(EncryptedString)

    # Token expiration (Unix timestamp)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)

    # Scopes granted by the OAuth flow
    scopes: Mapped[str | None] = mapped_column(Text)

    # Connection status: "connected", "expired", "error", "revoked"
    status: Mapped[str] = mapped_column(String(20), default="connected", nullable=False)

    # Last error message (if status is "error")
    last_error: Mapped[str | None] = mapped_column(Text)

    # User profile info from OAuth (email, name, etc.)
    profile_info: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

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
    user: Mapped["User"] = relationship("User")

    # Unique constraint: one token per provider per user
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_user_oauth_provider"),)
