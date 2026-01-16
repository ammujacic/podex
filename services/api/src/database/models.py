"""SQLAlchemy models for Podex database."""

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

from src.database.encrypted_types import EncryptedJSON


def _generate_uuid() -> str:
    """Generate a new UUID string."""
    return str(uuid4())


class Base(DeclarativeBase):
    """Base class for all models."""

    type_annotation_map: ClassVar[dict[type, type]] = {
        dict[str, Any]: JSONB,
    }


class User(Base):
    """User model."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    oauth_provider: Mapped[str | None] = mapped_column(String(50))
    oauth_id: Mapped[str | None] = mapped_column(String(255), index=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[str] = mapped_column(String(50), default="member", nullable=False, index=True)

    # MFA/2FA fields
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(255))  # Encrypted TOTP secret
    mfa_backup_codes: Mapped[list[str] | None] = mapped_column(JSONB)  # Hashed backup codes

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
    sessions: Mapped[list["Session"]] = relationship(
        "Session",
        back_populates="owner",
        cascade="all, delete-orphan",
        foreign_keys="[Session.owner_id]",
    )
    collaborations: Mapped[list["SessionCollaborator"]] = relationship(
        "SessionCollaborator",
        back_populates="user",
    )
    local_pods: Mapped[list["LocalPod"]] = relationship(
        "LocalPod",
        back_populates="owner",
        cascade="all, delete-orphan",
    )


class Session(Base):
    """Development session model."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
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
    template_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("pod_templates.id", ondelete="SET NULL"),
    )
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Sharing fields
    share_link: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    # Modes: view_only, can_edit, full_control
    share_link_mode: Mapped[str | None] = mapped_column(String(50))
    share_link_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Archival support
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    archived_by: Mapped[str | None] = mapped_column(
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
    owner: Mapped["User"] = relationship(
        "User",
        back_populates="sessions",
        foreign_keys="[Session.owner_id]",
    )
    workspace: Mapped["Workspace | None"] = relationship("Workspace", back_populates="session")
    collaborators: Mapped[list["SessionCollaborator"]] = relationship(
        "SessionCollaborator",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    agents: Mapped[list["Agent"]] = relationship(
        "Agent",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    shares: Mapped[list["SessionShare"]] = relationship(
        "SessionShare",
        back_populates="session",
        cascade="all, delete-orphan",
    )


class SessionCollaborator(Base):
    """Session collaborator model for multi-user sessions."""

    __tablename__ = "session_collaborators"

    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(String(50), default="editor")
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    session: Mapped["Session"] = relationship("Session", back_populates="collaborators")
    user: Mapped["User"] = relationship("User", back_populates="collaborations")


class Agent(Base):
    """AI agent model."""

    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="idle")
    # Agent mode: plan, ask, auto, sovereign
    # Note: "mode" is a reserved keyword in PostgreSQL (ordered-set aggregate function),
    # so we use quoted_name to ensure it's always quoted in SQL queries
    mode: Mapped[str] = mapped_column(
        quoted_name("mode", quote=True), String(20), default="ask", nullable=False
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
    # Agent kind: podex_native, terminal_external
    kind: Mapped[str] = mapped_column(String(20), default="podex_native", nullable=False)
    # Reference to terminal-integrated agent type (for terminal_external agents)
    terminal_agent_type_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("terminal_integrated_agent_types.id", ondelete="SET NULL"),
    )
    # Voice configuration for TTS (tts_enabled, auto_play, voice_id, speed, language)
    voice_config: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Context window tracking
    context_tokens_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    context_max_tokens: Mapped[int] = mapped_column(Integer, default=200000, nullable=False)
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
    session: Mapped["Session"] = relationship("Session", back_populates="agents")
    messages: Mapped[list["Message"]] = relationship(
        "Message",
        back_populates="agent",
        cascade="all, delete-orphan",
    )
    template: Mapped["AgentTemplate | None"] = relationship(
        "AgentTemplate",
        back_populates="agents",
    )
    terminal_agent_type: Mapped["TerminalIntegratedAgentType | None"] = relationship(
        "TerminalIntegratedAgentType",
    )
    pending_approvals: Mapped[list["AgentPendingApproval"]] = relationship(
        "AgentPendingApproval",
        back_populates="agent",
        cascade="all, delete-orphan",
    )


class AgentPendingApproval(Base):
    """Pending approval requests from agents in Ask/Auto mode.

    When an agent wants to perform a restricted action (file edit or command),
    it creates a pending approval that the user must approve or reject.
    """

    __tablename__ = "agent_pending_approvals"

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

    # Type of action: file_write, file_delete, command_execute
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Action details (tool name, arguments, file path, command, etc.)
    action_details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    # Status: pending, approved, rejected, expired
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)

    # Whether user can add this to allowlist (for commands in Auto mode)
    can_add_to_allowlist: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Response from user
    response_message: Mapped[str | None] = mapped_column(Text)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    responded_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    # If approved with add_to_allowlist, the command was added
    added_to_allowlist: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Expiration for automatic cleanup (default 5 minutes)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    agent: Mapped["Agent"] = relationship("Agent", back_populates="pending_approvals")
    session: Mapped["Session"] = relationship("Session")


class Message(Base):
    """Agent conversation message model."""

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    agent_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_calls: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    tokens_used: Mapped[int | None] = mapped_column()
    # Voice/audio fields
    audio_url: Mapped[str | None] = mapped_column(Text)  # S3 URL for audio
    audio_duration_ms: Mapped[int | None] = mapped_column(Integer)  # Duration in milliseconds
    input_type: Mapped[str] = mapped_column(String(20), default="text")  # "text" or "voice"
    transcription_confidence: Mapped[float | None] = mapped_column(Float)  # STT confidence score
    # TTS summary - short spoken version of the message (avoids reading code/plans)
    tts_summary: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    agent: Mapped["Agent"] = relationship("Agent", back_populates="messages")


class Workspace(Base):
    """Workspace model for compute environments."""

    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    container_id: Mapped[str | None] = mapped_column(String(255))
    s3_bucket: Mapped[str | None] = mapped_column(String(255))
    s3_prefix: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="pending")

    # Standby tracking
    standby_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_activity: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

    # Local pod hosting this workspace (NULL = cloud compute)
    local_pod_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("local_pods.id", ondelete="SET NULL"),
        index=True,
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
    session: Mapped["Session | None"] = relationship("Session", back_populates="workspace")
    local_pod: Mapped["LocalPod | None"] = relationship("LocalPod")
    file_changes: Mapped[list["FileChange"]] = relationship(
        "FileChange",
        back_populates="workspace",
        cascade="all, delete-orphan",
    )


class FileChange(Base):
    """File change audit log model."""

    __tablename__ = "file_changes"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    workspace_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    change_type: Mapped[str] = mapped_column(String(50), nullable=False)
    changed_by: Mapped[str] = mapped_column(String(255), nullable=False)
    diff: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Relationships
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="file_changes")


class SessionShare(Base):
    """Session sharing model for access control."""

    __tablename__ = "session_shares"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    shared_with_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    shared_with_email: Mapped[str | None] = mapped_column(String(255), index=True)
    sharing_mode: Mapped[str] = mapped_column(
        String(50),
        default="can_edit",
    )  # view_only, can_edit, full_control
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    session: Mapped["Session"] = relationship("Session", back_populates="shares")


class PodTemplate(Base):
    """Pod template model for predefined and custom pod configurations."""

    __tablename__ = "pod_templates"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(50))  # Emoji or icon name
    base_image: Mapped[str] = mapped_column(String(255), default="podex/workspace:latest")

    # Template configuration
    pre_install_commands: Mapped[list[str] | None] = mapped_column(JSONB)
    environment_variables: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    default_ports: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    packages: Mapped[list[str] | None] = mapped_column(JSONB)
    language_versions: Mapped[dict[str, str] | None] = mapped_column(JSONB)

    # Ownership and visibility
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    is_official: Mapped[bool] = mapped_column(Boolean, default=False)  # Podex official templates
    owner_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )

    # Stats
    usage_count: Mapped[int] = mapped_column(default=0)

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


class UserConfig(Base):
    """User configuration and dotfiles model."""

    __tablename__ = "user_configs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Dotfiles sync configuration
    sync_dotfiles: Mapped[bool] = mapped_column(Boolean, default=True)
    dotfiles_repo: Mapped[str | None] = mapped_column(Text)  # Optional git repo for dotfiles
    dotfiles_branch: Mapped[str | None] = mapped_column(String(100))  # Git branch for dotfiles
    dotfiles_files: Mapped[list[str] | None] = mapped_column(JSONB)  # Specific files to sync
    dotfiles_paths: Mapped[list[str] | None] = mapped_column(JSONB)  # Specific paths to sync
    dotfiles_last_sync: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )  # Last sync time

    # Default shell and editor
    default_shell: Mapped[str] = mapped_column(String(50), default="zsh")
    default_editor: Mapped[str] = mapped_column(String(50), default="vscode")

    # Git configuration (synced to pods)
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

    # S3 path for user's dotfiles
    s3_dotfiles_path: Mapped[str | None] = mapped_column(Text)

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


class ExecutionPlan(Base):
    """Execution plan for planning mode."""

    __tablename__ = "execution_plans"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="SET NULL"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    original_task: Mapped[str | None] = mapped_column(Text)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    current_step: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(
        String(50),
        default="pending_approval",
        nullable=False,
        index=True,
    )
    confidence_score: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MCPServer(Base):
    """MCP server configuration for external tool integration."""

    __tablename__ = "mcp_servers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    transport: Mapped[str] = mapped_column(String(20), nullable=False)  # stdio, sse, http
    command: Mapped[str | None] = mapped_column(Text)  # For stdio transport
    args: Mapped[list[str] | None] = mapped_column(JSONB)
    url: Mapped[str | None] = mapped_column(Text)  # For sse/http transport
    # Environment variables stored encrypted at rest for security
    env_vars: Mapped[dict[str, str] | None] = mapped_column(EncryptedJSON)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    discovered_tools: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    discovered_resources: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    last_connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)

    # Default registry tracking fields
    # source_slug: e.g., "github", "postgres"
    source_slug: Mapped[str | None] = mapped_column(String(50), index=True)
    # category: e.g., "database", "version_control"
    category: Mapped[str | None] = mapped_column(String(30))
    # is_default: From defaults catalog
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # config_source: "env", "ui", "api"
    config_source: Mapped[str] = mapped_column(String(10), default="ui", nullable=False)
    icon: Mapped[str | None] = mapped_column(String(50))

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

    # Unique constraint: user can't have duplicate names
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_mcp_servers_user_name"),)


class LocalPod(Base):
    """Self-hosted local pod model for user-managed compute.

    Local pods are user-registered machines that connect to Podex cloud
    via outbound WebSocket to run workspaces on user hardware.
    """

    __tablename__ = "local_pods"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Authentication - token is hashed, prefix shown for identification
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # SHA-256 hash
    # First 8 chars for display
    token_prefix: Mapped[str] = mapped_column(String(8), nullable=False)

    # Connection status
    status: Mapped[str] = mapped_column(
        String(20),
        default="offline",
        nullable=False,
        index=True,
    )  # offline, online, busy, error
    last_heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)

    # Capabilities reported by pod on connection
    os_info: Mapped[str | None] = mapped_column(String(100))  # e.g., "Linux 5.15.0-ubuntu22.04"
    architecture: Mapped[str | None] = mapped_column(String(20))  # x86_64, arm64
    docker_version: Mapped[str | None] = mapped_column(String(50))
    total_memory_mb: Mapped[int | None] = mapped_column(Integer)
    total_cpu_cores: Mapped[int | None] = mapped_column(Integer)

    # Workspace limits
    max_workspaces: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    current_workspaces: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Labels for workspace routing (e.g., {"gpu": true, "region": "home"})
    labels: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

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
    owner: Mapped["User"] = relationship("User", back_populates="local_pods")

    # Unique constraint: user can't have duplicate pod names
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_local_pods_user_name"),)


class AgentAttention(Base):
    """Agent attention notification model.

    Tracks when agents need user attention (approval, completion, errors, input).
    """

    __tablename__ = "agent_attentions"

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
    attention_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )  # needs_approval, completed, error, waiting_input
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    attention_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    # priority: low, medium, high, critical
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_dismissed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationships
    agent: Mapped["Agent"] = relationship("Agent")
    session: Mapped["Session"] = relationship("Session")


# =============================================================================
# BILLING MODELS
# =============================================================================


class SubscriptionPlan(Base):
    """Subscription plan model defining available plans and pricing."""

    __tablename__ = "subscription_plans"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)

    # Pricing (stored as cents to avoid floating point issues)
    price_monthly_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    price_yearly_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)

    # Included allowances (monthly)
    tokens_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Legacy field - use compute_credits_cents_included instead
    compute_hours_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    compute_credits_cents_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    storage_gb_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Limits
    max_agents: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    max_sessions: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    max_team_members: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # Overage rates (stored as cents per unit)
    overage_token_rate_cents: Mapped[int] = mapped_column(Integer, default=0)  # Per 1000 tokens
    overage_compute_rate_cents: Mapped[int] = mapped_column(Integer, default=0)  # Per hour
    overage_storage_rate_cents: Mapped[int] = mapped_column(Integer, default=0)  # Per GB/month
    overage_allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Margin percentages (internal - not exposed to users)
    # Applied on top of base provider costs to calculate final user pricing
    # Values represent percentages, e.g., 20 = 20%
    llm_margin_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    compute_margin_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Features (JSONB for flexibility)
    features: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)

    # Display settings
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    is_popular: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_enterprise: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Stripe integration (for future)
    stripe_price_id_monthly: Mapped[str | None] = mapped_column(String(255))
    stripe_price_id_yearly: Mapped[str | None] = mapped_column(String(255))
    stripe_product_id: Mapped[str | None] = mapped_column(String(255))

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
    subscriptions: Mapped[list["UserSubscription"]] = relationship(
        "UserSubscription",
        back_populates="plan",
    )


class UserSubscription(Base):
    """User subscription model tracking active subscriptions."""

    __tablename__ = "user_subscriptions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    plan_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("subscription_plans.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Status
    status: Mapped[str] = mapped_column(
        String(50),
        default="active",
        nullable=False,
        index=True,
    )  # active, canceled, past_due, trialing, paused, incomplete

    # Billing cycle: "monthly" or "yearly"
    billing_cycle: Mapped[str] = mapped_column(String(20), default="monthly", nullable=False)
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Cancellation
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_reason: Mapped[str | None] = mapped_column(Text)

    # Trial
    trial_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trial_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Stripe integration (for future)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), index=True)

    # Metadata
    subscription_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)

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
    plan: Mapped["SubscriptionPlan"] = relationship(
        "SubscriptionPlan",
        back_populates="subscriptions",
    )


class UsageRecord(Base):
    """Usage record model for tracking billable usage."""

    __tablename__ = "usage_records"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="SET NULL"),
        index=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspaces.id", ondelete="SET NULL"),
        index=True,
    )
    agent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="SET NULL"),
        index=True,
    )

    # Usage type and quantity
    usage_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )  # tokens_input, tokens_output, compute_seconds, storage_gb, api_calls
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)  # Amount in base units
    unit: Mapped[str] = mapped_column(String(20), nullable=False)  # tokens, seconds, bytes, calls

    # Pricing (stored as cents)
    unit_price_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Base cost is what we pay providers (internal tracking)
    base_cost_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Total cost is what user pays (base + margin)
    total_cost_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Context
    model: Mapped[str | None] = mapped_column(String(100))  # For token usage
    tier: Mapped[str | None] = mapped_column(String(50))  # For compute usage

    # Billing period reference
    billing_period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        index=True,
    )
    billing_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Whether this was charged or within included allowance
    is_overage: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Additional metadata
    record_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )


class UsageQuota(Base):
    """Usage quota model for tracking limits and current usage."""

    __tablename__ = "usage_quotas"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Quota type
    quota_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )  # tokens, compute_hours, storage_gb, api_calls, sessions, agents

    # Limits
    limit_value: Mapped[int] = mapped_column(Integer, nullable=False)
    current_usage: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Reset timing
    reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Overage settings
    overage_allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    overage_rate_cents: Mapped[int | None] = mapped_column(Integer)  # Price per unit over limit
    hard_limit: Mapped[int | None] = mapped_column(Integer)  # Absolute maximum (even with overage)

    # Alert thresholds
    warning_threshold_percent: Mapped[int] = mapped_column(Integer, default=80, nullable=False)
    warning_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

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

    # Unique constraint: one quota per type per user
    __table_args__ = (UniqueConstraint("user_id", "quota_type", name="uq_usage_quotas_user_type"),)


class CreditTransaction(Base):
    """Credit transaction model for tracking credit purchases and usage."""

    __tablename__ = "credit_transactions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Transaction details
    # Positive for credits, negative for usage
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    transaction_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )  # purchase, bonus, referral, refund, usage, expiry, subscription_credit
    description: Mapped[str] = mapped_column(String(500), nullable=False)

    # Reference to what caused this transaction
    # usage_record, invoice, subscription
    reference_type: Mapped[str | None] = mapped_column(String(50))
    reference_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))

    # Stripe integration
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255), index=True)
    stripe_charge_id: Mapped[str | None] = mapped_column(String(255))

    # Expiration (for promotional credits)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    expired: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Running balance after this transaction
    balance_after_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )


class CreditBalance(Base):
    """Credit balance model for quick balance lookups."""

    __tablename__ = "credit_balances"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Current balance (in cents)
    balance_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Pending balance (credits being processed)
    pending_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Credits expiring soon (next 30 days)
    expiring_soon_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Lifetime stats
    total_purchased_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_used_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_bonus_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Invoice(Base):
    """Invoice model for billing records."""

    __tablename__ = "invoices"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subscription_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("user_subscriptions.id", ondelete="SET NULL"),
        index=True,
    )

    # Invoice number (human readable)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)

    # Amounts (in cents)
    subtotal_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    discount_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tax_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)

    # Status
    status: Mapped[str] = mapped_column(
        String(50),
        default="draft",
        nullable=False,
        index=True,
    )  # draft, open, paid, void, uncollectible

    # Line items (JSONB for flexibility)
    line_items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)

    # Period
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Payment info
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_method: Mapped[str | None] = mapped_column(String(50))  # card, bank_transfer, credits

    # Stripe integration
    stripe_invoice_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255))

    # PDF storage
    pdf_url: Mapped[str | None] = mapped_column(Text)

    # Notes
    notes: Mapped[str | None] = mapped_column(Text)

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


class BillingEvent(Base):
    """Billing event audit log model."""

    __tablename__ = "billing_events"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Event type
    event_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )  # subscription_created, payment_succeeded, quota_exceeded, etc.

    # Event data (full context)
    event_data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)

    # Request context (for audit trail)
    ip_address: Mapped[str | None] = mapped_column(String(45))  # IPv6 compatible
    user_agent: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str | None] = mapped_column(String(100))

    # Related entities
    subscription_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    invoice_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    transaction_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )


# =============================================================================
# HARDWARE SPECIFICATION MODEL
# =============================================================================


class HardwareSpec(Base):
    """Hardware specification model for available compute tiers."""

    __tablename__ = "hardware_specs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    tier: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # Hardware specifications
    architecture: Mapped[str] = mapped_column(String(20), nullable=False)  # x86_64, arm64
    vcpu: Mapped[int] = mapped_column(Integer, nullable=False)
    memory_mb: Mapped[int] = mapped_column(Integer, nullable=False)

    # GPU specifications
    gpu_type: Mapped[str | None] = mapped_column(String(50))  # t4, a10g, a100_40gb, etc.
    gpu_memory_gb: Mapped[int | None] = mapped_column(Integer)
    gpu_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Storage limits
    storage_gb_default: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    storage_gb_max: Mapped[int] = mapped_column(Integer, default=100, nullable=False)

    # Pricing (cents per hour)
    hourly_rate_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    # Availability
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    # Minimum plan slug required
    requires_subscription: Mapped[str | None] = mapped_column(String(50))

    # Region availability (JSONB array of region codes)
    region_availability: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    # AWS/Cloud specifics
    aws_instance_type: Mapped[str | None] = mapped_column(String(50))
    ecs_cpu_units: Mapped[int | None] = mapped_column(Integer)
    ecs_memory_mb: Mapped[int | None] = mapped_column(Integer)

    # Display order
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

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


# =============================================================================
# PLATFORM SETTINGS MODEL
# =============================================================================


class PlatformSetting(Base):
    """Platform-wide settings and configuration managed by admins."""

    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50), default="general", nullable=False, index=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )


# =============================================================================
# LLM MODEL CONFIGURATION
# =============================================================================


class LLMModel(Base):
    """LLM model configuration for dynamic model management.

    Stores available LLM models with their capabilities, costs, and settings.
    Admins can add/modify models without code changes.
    """

    __tablename__ = "llm_models"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    # Unique model identifier (e.g., "anthropic.claude-opus-4-5-20251101-v1:0")
    model_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    # User-friendly display name (e.g., "Claude Opus 4.5")
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Provider: bedrock, anthropic, openai, ollama
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Model family: anthropic, llama, titan, cohere, mistral, openai
    family: Mapped[str] = mapped_column(String(50), nullable=False)
    # Cost tier: low, medium, high, premium
    cost_tier: Mapped[str] = mapped_column(String(20), nullable=False)
    # Input/output cost per million tokens (cents)
    input_cost_per_million: Mapped[float | None] = mapped_column(Float)
    output_cost_per_million: Mapped[float | None] = mapped_column(Float)
    # Model capabilities
    capabilities: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False
    )  # vision, thinking, extended_thinking, tool_use, streaming, json_mode
    # Context window size in tokens
    context_window: Mapped[int] = mapped_column(Integer, default=200000, nullable=False)
    # Max output tokens
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=8192, nullable=False)
    # Whether model is enabled for use
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    # Whether this is a default model for new agents
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Whether this model requires user's own API key (vs platform-provided)
    is_user_key_model: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, index=True
    )
    # Sort order for display in dropdowns
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    # Additional metadata (release date, description, etc.)
    model_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
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


# =============================================================================
# NOTIFICATION MODEL
# =============================================================================


class Notification(Base):
    """User notification model."""

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # info, warning, error, success
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    action_url: Mapped[str | None] = mapped_column(String(500))
    action_label: Mapped[str | None] = mapped_column(String(100))
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Relationships
    user: Mapped["User"] = relationship("User")


# =============================================================================
# CONTEXT WINDOW & COMPACTION MODELS
# =============================================================================


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


# =============================================================================
# CHECKPOINT/UNDO SYSTEM MODELS
# =============================================================================


class FileCheckpoint(Base):
    """Checkpoint snapshot before agent file edits."""

    __tablename__ = "file_checkpoints"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="SET NULL"),
        index=True,
    )
    agent_name: Mapped[str | None] = mapped_column(String(255))
    checkpoint_number: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    action_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # file_edit, file_create, file_delete, batch_edit
    status: Mapped[str] = mapped_column(
        String(20), default="active", nullable=False
    )  # active, restored, superseded
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    restored_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Relationships
    files: Mapped[list["CheckpointFile"]] = relationship(
        "CheckpointFile",
        back_populates="checkpoint",
        cascade="all, delete-orphan",
    )

    # Unique constraint: sequential checkpoint numbers per session
    __table_args__ = (
        UniqueConstraint("session_id", "checkpoint_number", name="uq_checkpoint_session_number"),
    )


class CheckpointFile(Base):
    """Individual file state within a checkpoint."""

    __tablename__ = "checkpoint_files"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    checkpoint_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("file_checkpoints.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    change_type: Mapped[str] = mapped_column(String(20), nullable=False)  # create, modify, delete
    content_before: Mapped[str | None] = mapped_column(Text)  # NULL for creates
    content_after: Mapped[str | None] = mapped_column(Text)  # NULL for deletes
    s3_key_before: Mapped[str | None] = mapped_column(Text)  # For large files
    s3_key_after: Mapped[str | None] = mapped_column(Text)
    file_size_before: Mapped[int | None] = mapped_column(Integer)
    file_size_after: Mapped[int | None] = mapped_column(Integer)
    lines_added: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lines_removed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    checkpoint: Mapped["FileCheckpoint"] = relationship("FileCheckpoint", back_populates="files")


# =============================================================================
# AGGREGATED DIFF/CHANGE SET MODELS
# =============================================================================


class PendingChangeSet(Base):
    """Collection of pending file changes from agent work."""

    __tablename__ = "pending_change_sets"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="SET NULL"),
        index=True,
    )
    agent_name: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False, index=True
    )  # pending, applied, rejected, partial
    total_files: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_additions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_deletions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Relationships
    files: Mapped[list["ChangeSetFile"]] = relationship(
        "ChangeSetFile",
        back_populates="change_set",
        cascade="all, delete-orphan",
    )


class ChangeSetFile(Base):
    """Individual file in a pending change set with hunks."""

    __tablename__ = "change_set_files"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    change_set_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("pending_change_sets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # added, modified, deleted
    original_content: Mapped[str | None] = mapped_column(Text)
    new_content: Mapped[str | None] = mapped_column(Text)
    hunks: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False
    )  # [{id, oldStart, oldLines, newStart, newLines, lines, selected}]
    additions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deletions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    review_status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )  # pending, accepted, rejected, partial
    accepted_hunk_ids: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    change_set: Mapped["PendingChangeSet"] = relationship(
        "PendingChangeSet", back_populates="files"
    )


# =============================================================================
# HOOKS SYSTEM MODELS
# =============================================================================


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


# =============================================================================
# PROGRESS TRACKING MODELS
# =============================================================================


class TaskProgress(Base):
    """Progress tracking for agent task execution."""

    __tablename__ = "task_progress"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False
    )  # [{id, description, status, started_at, completed_at, elapsed_ms}]
    current_step_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    overall_progress: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)  # 0-100
    status: Mapped[str] = mapped_column(
        String(20), default="running", nullable=False
    )  # running, completed, failed, cancelled
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# =============================================================================
# COST & BUDGET MODELS
# =============================================================================


class UserBudget(Base):
    """User budget settings for cost control."""

    __tablename__ = "user_budgets"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    daily_budget_cents: Mapped[int | None] = mapped_column(Integer)
    monthly_budget_cents: Mapped[int | None] = mapped_column(Integer)
    session_default_budget_cents: Mapped[int | None] = mapped_column(Integer)
    alert_threshold_percent: Mapped[int] = mapped_column(Integer, default=80, nullable=False)
    hard_limit_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
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


class SessionBudget(Base):
    """Per-session budget settings."""

    __tablename__ = "session_budgets"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    budget_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    spent_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    alert_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class CostAlert(Base):
    """Cost alert history for audit."""

    __tablename__ = "cost_alerts"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="SET NULL"),
        index=True,
    )
    alert_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # budget_warning, budget_exceeded, daily_limit, monthly_limit
    threshold_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )


# =============================================================================
# WIKI/KNOWLEDGE MODELS
# =============================================================================


class WikiDocument(Base):
    """Auto-generated wiki documentation."""

    __tablename__ = "wiki_documents"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    doc_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # overview, api, architecture, component
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class UserCorrection(Base):
    """User corrections for agent learning."""

    __tablename__ = "user_corrections"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    original_content: Mapped[str] = mapped_column(Text, nullable=False)
    corrected_content: Mapped[str] = mapped_column(Text, nullable=False)
    correction_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # code, explanation, approach
    applied_to_podex_md: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


# =============================================================================
# SUBAGENT TRACKING MODELS
# =============================================================================


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


# =============================================================================
# AGENT WORKTREE MODELS (for parallel execution)
# =============================================================================


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


# =============================================================================
# CUSTOM COMMANDS MODELS
# =============================================================================


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
