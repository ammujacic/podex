"""Skill management models.

Includes: SystemSkill, SkillVersion, SkillTemplate, SkillExecution,
SkillRepository, SkillSyncLog.
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, _generate_uuid


class SystemSkill(Base):
    """Platform-wide skill managed by admins, available to all users."""

    __tablename__ = "system_skills"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(String(20), default="1.0.0", nullable=False)
    author: Mapped[str] = mapped_column(String(100), default="system", nullable=False)

    # Skill definition (mirrors YAML structure)
    triggers: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    required_tools: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    required_context: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    system_prompt: Mapped[str | None] = mapped_column(Text)
    examples: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    skill_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, name="metadata"
    )  # category, estimated_duration, requires_approval

    # Admin controls
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    is_default: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )  # Included for all users
    allowed_plans: Mapped[list[str] | None] = mapped_column(
        JSONB
    )  # Restrict to specific subscription plans
    allowed_roles: Mapped[list[str] | None] = mapped_column(
        JSONB
    )  # Restrict to specific agent roles

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
    created_by: Mapped[str | None] = mapped_column(String(100))  # Admin who created

    # Relationships
    executions: Mapped[list["SkillExecution"]] = relationship(
        "SkillExecution",
        back_populates="system_skill",
        cascade="all, delete-orphan",
        foreign_keys="SkillExecution.system_skill_id",
    )


class SkillVersion(Base):
    """Version history for user skills."""

    __tablename__ = "skill_versions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    skill_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("user_skills.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[str] = mapped_column(String(20), nullable=False)  # semver
    version_index: Mapped[int] = mapped_column(Integer, nullable=False)  # auto-increment per skill

    # Snapshot of skill at this version
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    triggers: Mapped[list[str] | None] = mapped_column(JSONB)
    tags: Mapped[list[str] | None] = mapped_column(JSONB)
    required_tools: Mapped[list[str] | None] = mapped_column(JSONB)
    steps: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    system_prompt: Mapped[str | None] = mapped_column(Text)

    change_summary: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(20), nullable=False)  # user, agent, sync
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Unique constraint: one version index per skill
    __table_args__ = (
        UniqueConstraint("skill_id", "version_index", name="uq_skill_versions_skill_index"),
    )


class SkillTemplate(Base):
    """Template for creating new skills with predefined structure."""

    __tablename__ = "skill_templates"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # deployment, testing, generation, etc.
    icon: Mapped[str | None] = mapped_column(String(50))

    # Template definition
    default_triggers: Mapped[list[str] | None] = mapped_column(JSONB)
    default_tags: Mapped[list[str] | None] = mapped_column(JSONB)
    required_tools: Mapped[list[str] | None] = mapped_column(JSONB)
    step_templates: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    variables: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSONB
    )  # {name, type, description, default}
    default_system_prompt: Mapped[str | None] = mapped_column(Text)

    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
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


class SkillExecution(Base):
    """Record of skill execution for analytics."""

    __tablename__ = "skill_executions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Support both skill types - one will be set
    skill_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("user_skills.id", ondelete="SET NULL"),
        index=True,
    )
    system_skill_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("system_skills.id", ondelete="SET NULL"),
        index=True,
    )
    skill_slug: Mapped[str] = mapped_column(
        String(100), nullable=False, index=True
    )  # For tracking even if skill deleted
    skill_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "system" or "user"

    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), index=True)
    agent_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), index=True)

    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    steps_completed: Mapped[int] = mapped_column(Integer, nullable=False)
    total_steps: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)

    context_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    results_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    executed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Relationships
    system_skill: Mapped["SystemSkill | None"] = relationship(
        "SystemSkill",
        back_populates="executions",
        foreign_keys=[system_skill_id],
    )


class SkillRepository(Base):
    """Git repository connected for skill synchronization."""

    __tablename__ = "skill_repositories"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    repo_url: Mapped[str] = mapped_column(String(500), nullable=False)
    branch: Mapped[str] = mapped_column(String(100), default="main", nullable=False)
    skills_path: Mapped[str] = mapped_column(String(200), default="/", nullable=False)
    sync_direction: Mapped[str] = mapped_column(
        String(20), default="pull", nullable=False
    )  # pull, push, bidirectional
    webhook_secret: Mapped[str | None] = mapped_column(String(100))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_status: Mapped[str | None] = mapped_column(String(20))  # success, failed, pending
    last_sync_error: Mapped[str | None] = mapped_column(Text)
    last_commit_sha: Mapped[str | None] = mapped_column(String(40))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
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
    sync_logs: Mapped[list["SkillSyncLog"]] = relationship(
        "SkillSyncLog",
        back_populates="repository",
        cascade="all, delete-orphan",
    )

    # Unique constraint: one repo URL per user
    __table_args__ = (
        UniqueConstraint("user_id", "repo_url", name="uq_skill_repositories_user_repo"),
    )


class MarketplaceSkill(Base):
    """Skill submitted to the marketplace for approval."""

    __tablename__ = "marketplace_skills"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Submitter info
    submitted_by: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Skill definition (same as UserSkill/SystemSkill)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(String(20), default="1.0.0", nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="general", nullable=False, index=True)
    triggers: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    required_tools: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    required_context: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    system_prompt: Mapped[str | None] = mapped_column(Text)
    examples: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    skill_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, name="metadata")

    # Approval status
    status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
        index=True,
    )  # pending, approved, rejected
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Once approved, this links to the SystemSkill created
    approved_skill_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("system_skills.id", ondelete="SET NULL"),
    )

    # Stats
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    install_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    submitted_at: Mapped[datetime] = mapped_column(
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

    # Unique slug in marketplace
    __table_args__ = (UniqueConstraint("slug", name="uq_marketplace_skills_slug"),)


class UserAddedSkill(Base):
    """Tracks skills that a user has added from the marketplace to their account."""

    __tablename__ = "user_added_skills"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Link to system skill (marketplace skills become system skills when approved)
    system_skill_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("system_skills.id", ondelete="SET NULL"),
        index=True,
    )

    # Store the slug separately so we can gracefully handle deleted skills
    skill_slug: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    skill_name: Mapped[str] = mapped_column(String(100), nullable=False)

    # When was it added
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Usage tracking for this user
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # User can disable without removing
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Unique: one entry per user per skill
    __table_args__ = (
        UniqueConstraint("user_id", "skill_slug", name="uq_user_added_skills_user_skill"),
    )


class SkillSyncLog(Base):
    """Log of skill synchronization events."""

    __tablename__ = "skill_sync_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    repository_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("skill_repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    direction: Mapped[str] = mapped_column(String(20), nullable=False)  # pull, push
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # success, failed
    skills_added: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skills_updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skills_removed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    commit_sha: Mapped[str | None] = mapped_column(String(40))
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationships
    repository: Mapped["SkillRepository"] = relationship(
        "SkillRepository",
        back_populates="sync_logs",
    )
