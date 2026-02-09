"""Core models: User, Session, Agent, Workspace and related."""

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
    func,
    quoted_name,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, _generate_uuid

if TYPE_CHECKING:
    from .agent_config import AgentTemplate
    from .conversation import ConversationSession
    from .device_session import DeviceSession
    from .extensions import UserExtension, WorkspaceExtension
    from .infrastructure import GitHubIntegration, GoogleIntegration, LocalPod
    from .organization import OrganizationMember


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

    # SSH public keys for VS Code Remote-SSH and other SSH clients
    # List of dicts with: name, key (public key string), fingerprint, created_at
    ssh_public_keys: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)

    # Organization billing context
    # When user joins an org, personal billing is suspended (not canceled)
    personal_billing_suspended: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    personal_billing_suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Account type chosen at signup: "personal" or "organization"
    account_type: Mapped[str] = mapped_column(String(50), default="personal", nullable=False)

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
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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
    extensions: Mapped[list["UserExtension"]] = relationship(
        "UserExtension",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    # Organization membership (one-to-one, user can only be in one org)
    organization_member: Mapped["OrganizationMember | None"] = relationship(
        "OrganizationMember",
        back_populates="user",
        uselist=False,
    )
    # GitHub integration (one-to-one)
    github_integration: Mapped["GitHubIntegration | None"] = relationship(
        "GitHubIntegration",
        back_populates="owner",
        uselist=False,
        cascade="all, delete-orphan",
    )
    # Google integration (one-to-one)
    google_integration: Mapped["GoogleIntegration | None"] = relationship(
        "GoogleIntegration",
        back_populates="owner",
        uselist=False,
        cascade="all, delete-orphan",
    )
    # Device sessions (active login sessions across devices)
    device_sessions: Mapped[list["DeviceSession"]] = relationship(
        "DeviceSession",
        back_populates="user",
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
    conversation_sessions: Mapped[list["ConversationSession"]] = relationship(
        "ConversationSession",
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
    # Note: This field is deprecated and will be removed in future versions
    terminal_agent_type_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        nullable=True,
    )
    # Voice configuration for TTS (tts_enabled, auto_play, voice_id, speed, language)
    voice_config: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Context window tracking
    context_tokens_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    context_max_tokens: Mapped[int] = mapped_column(Integer, default=200000, nullable=False)

    # Status tracking for watchdog (detects stuck agents)
    status_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
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
    session: Mapped["Session"] = relationship("Session", back_populates="agents")
    template: Mapped["AgentTemplate | None"] = relationship(
        "AgentTemplate",
        back_populates="agents",
    )
    pending_approvals: Mapped[list["AgentPendingApproval"]] = relationship(
        "AgentPendingApproval",
        back_populates="agent",
        cascade="all, delete-orphan",
    )
    # The conversation attached to this agent (via junction table).
    # An agent can only have ONE conversation attached (unique constraint on junction).
    # uselist=False because agent can only have one conversation.
    attached_conversation: Mapped["ConversationSession | None"] = relationship(
        "ConversationSession",
        secondary="agent_conversation_attachments",
        back_populates="attached_agents",
        uselist=False,
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


class PendingChange(Base):
    """Pending file change proposed by an agent for user review.

    When an agent in Ask mode wants to modify a file, it creates a pending change
    instead of directly writing. The user can then review the diff and accept or reject.
    """

    __tablename__ = "pending_changes"

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

    # File information
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    original_content: Mapped[str | None] = mapped_column(Text)  # NULL for new files
    proposed_content: Mapped[str] = mapped_column(Text, nullable=False)

    # Optional description from agent explaining the change
    description: Mapped[str | None] = mapped_column(Text)

    # Status: pending, accepted, rejected
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)

    # User feedback when rejecting
    rejection_feedback: Mapped[str | None] = mapped_column(Text)

    # Resolution tracking
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    session: Mapped["Session"] = relationship("Session")
    agent: Mapped["Agent"] = relationship("Agent")


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

    # Multi-server orchestration: Which server hosts this workspace
    # Human-readable server ID (e.g., "ws-local-1") - matches compute service config
    server_id: Mapped[str | None] = mapped_column(
        String(255),
        ForeignKey("workspace_servers.id", ondelete="SET NULL"),
        index=True,
    )

    # Container/volume tracking for Docker workspaces
    container_name: Mapped[str | None] = mapped_column(String(255))
    volume_name: Mapped[str | None] = mapped_column(String(255))

    # Resource allocation
    assigned_cpu: Mapped[float | None] = mapped_column(Float)
    assigned_memory_mb: Mapped[int | None] = mapped_column(Integer)
    assigned_disk_gb: Mapped[int | None] = mapped_column(Integer)
    assigned_bandwidth_mbps: Mapped[int | None] = mapped_column(Integer)

    # Region preference (user-selected region for compliance)
    region_preference: Mapped[str | None] = mapped_column(String(50))  # "eu", "us"

    # Networking
    internal_ip: Mapped[str | None] = mapped_column(String(45))  # IPv6-safe length
    workspace_ssh_port: Mapped[int | None] = mapped_column(Integer)
    workspace_http_port: Mapped[int | None] = mapped_column(Integer)

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
    server: Mapped["WorkspaceServer | None"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "WorkspaceServer",
        back_populates="workspaces",
    )
    file_changes: Mapped[list["FileChange"]] = relationship(
        "FileChange",
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    extensions: Mapped[list["WorkspaceExtension"]] = relationship(
        "WorkspaceExtension",
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
