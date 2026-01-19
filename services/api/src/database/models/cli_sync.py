"""CLI sync models for syncing skills and MCPs to CLI wrapper agents.

Tracks synchronization status between Podex skills/MCPs and CLI tools like
Claude Code, OpenAI Codex, and Google Gemini CLI.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
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


class CLISyncStatus(Base):
    """Tracks sync status for skills/MCPs to CLI agents.

    Each record represents the sync state of a single skill or MCP to a
    specific CLI tool. This enables bidirectional sync with conflict detection.
    """

    __tablename__ = "cli_sync_status"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # What is being synced
    sync_type: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )  # "skill" | "mcp"
    source_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )  # FK to skill or MCP (not enforced to support multiple tables)
    source_table: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # "user_skills" | "system_skills" | "mcp_servers"

    # Target CLI agent
    cli_agent: Mapped[str] = mapped_column(
        String(30), nullable=False, index=True
    )  # "claude_code" | "codex" | "gemini_cli"

    # Sync status
    sync_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )  # "pending" | "synced" | "failed" | "conflict"
    sync_direction: Mapped[str] = mapped_column(
        String(20), nullable=False, default="to_cli"
    )  # "to_cli" | "from_cli" | "bidirectional"

    # Tracking
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_error: Mapped[str | None] = mapped_column(Text)

    # Version tracking for conflict resolution
    podex_version: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False
    )  # Incremented on Podex changes
    cli_version: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )  # Incremented on CLI config changes
    cli_config_hash: Mapped[str | None] = mapped_column(
        String(64)
    )  # Hash of CLI config for change detection

    # The translated config (cached)
    translated_config: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # CLI-specific format

    # File path in CLI config directory (for skills)
    cli_file_path: Mapped[str | None] = mapped_column(String(255))  # e.g., "commands/my-skill.md"

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

    __table_args__ = (
        UniqueConstraint("user_id", "source_id", "cli_agent", name="uq_cli_sync_user_source_cli"),
    )


class CLISyncLog(Base):
    """Log of CLI sync operations for audit trail.

    Records each sync operation with counts of items synced, failed,
    and any conflicts encountered.
    """

    __tablename__ = "cli_sync_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # What was synced
    cli_agent: Mapped[str] = mapped_column(
        String(30), nullable=False, index=True
    )  # "claude_code" | "codex" | "gemini_cli" | "all"
    sync_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "skill" | "mcp" | "bulk"
    direction: Mapped[str] = mapped_column(String(20), nullable=False)  # "push" | "pull"

    # Results
    items_synced: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    items_failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    conflicts_resolved: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    conflicts_deferred: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Details
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # Per-item results
    error_message: Mapped[str | None] = mapped_column(Text)

    # Timing
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Duration in milliseconds
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class CLISyncConflict(Base):
    """Unresolved sync conflicts requiring user intervention.

    When a skill or MCP has been modified in both Podex and the CLI config,
    a conflict is created. Users can resolve by choosing one version or merging.
    """

    __tablename__ = "cli_sync_conflicts"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Reference to sync status
    sync_status_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("cli_sync_status.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Conflict details
    conflict_type: Mapped[str] = mapped_column(
        String(30), nullable=False
    )  # "content_mismatch" | "deleted_in_podex" | "deleted_in_cli"

    # Snapshots of both versions
    podex_version: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    cli_version: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Resolution
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    resolution: Mapped[str | None] = mapped_column(
        String(30)
    )  # "use_podex" | "use_cli" | "merge" | "delete"
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
