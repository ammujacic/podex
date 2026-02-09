"""Checkpoint and change set models for undo/redo functionality."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, _generate_uuid


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
