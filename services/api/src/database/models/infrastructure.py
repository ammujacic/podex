"""Infrastructure models: PodTemplate, LocalPod, MCPServer."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database.encrypted_types import EncryptedJSON, EncryptedString

from .base import Base, _generate_uuid

if TYPE_CHECKING:
    from .core import User


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
    architecture: Mapped[str | None] = mapped_column(String(20))  # x86_64
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


class DefaultMCPServer(Base):
    """Default MCP server catalog entry.

    This is the single source of truth for the MCP server catalog.
    Seeded from DEFAULT_MCP_SERVERS and can be customized by admins.
    Users enable servers from this catalog which creates MCPServer records.
    """

    __tablename__ = "default_mcp_servers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(
        String(30), nullable=False
    )  # version_control, web, memory, etc.
    transport: Mapped[str] = mapped_column(String(20), nullable=False)  # stdio, sse, http
    command: Mapped[str | None] = mapped_column(Text)  # For stdio transport
    args: Mapped[list[str] | None] = mapped_column(JSONB)
    url: Mapped[str | None] = mapped_column(Text)  # For sse/http transport
    env_vars: Mapped[dict[str, str] | None] = mapped_column(JSONB)  # Default env vars
    required_env: Mapped[list[str] | None] = mapped_column(JSONB)  # Required env var names
    optional_env: Mapped[list[str] | None] = mapped_column(JSONB)  # Optional env var names
    icon: Mapped[str | None] = mapped_column(String(50))
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    docs_url: Mapped[str | None] = mapped_column(Text)

    # Ordering and visibility
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_system: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )  # System servers can't be deleted

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


class GitHubIntegration(Base):
    """GitHub OAuth integration for PR/Actions access."""

    __tablename__ = "github_integrations"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # GitHub user info
    github_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    github_username: Mapped[str] = mapped_column(String(100), nullable=False)
    github_avatar_url: Mapped[str | None] = mapped_column(Text)
    github_email: Mapped[str | None] = mapped_column(String(255))

    # OAuth tokens - encrypted at rest
    access_token: Mapped[str] = mapped_column(EncryptedString, nullable=False)  # Encrypted
    refresh_token: Mapped[str | None] = mapped_column(EncryptedString)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Scopes granted during OAuth
    scopes: Mapped[list[str] | None] = mapped_column(JSONB)

    # Installation info (for GitHub Apps)
    installation_id: Mapped[int | None] = mapped_column(Integer)
    installation_target_type: Mapped[str | None] = mapped_column(String(20))  # User, Organization
    installation_target_id: Mapped[int | None] = mapped_column(Integer)

    # Repository access settings
    repository_access: Mapped[str] = mapped_column(
        String(20), default="all", nullable=False
    )  # all, selected
    selected_repositories: Mapped[list[str] | None] = mapped_column(
        JSONB
    )  # list of repo full names

    # Webhook configuration
    webhook_secret: Mapped[str | None] = mapped_column(EncryptedString)  # Encrypted
    webhook_events: Mapped[list[str] | None] = mapped_column(JSONB)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)

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
    owner: Mapped["User"] = relationship("User", back_populates="github_integration")
