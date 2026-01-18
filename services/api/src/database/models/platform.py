"""Platform configuration models: PlatformSetting, LLMModel."""

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _generate_uuid


class PlatformSetting(Base):
    """Platform-wide settings and configuration managed by admins."""

    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict[str, Any] | list[Any]] = mapped_column(JSONB, nullable=False)
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


class LLMProvider(Base):
    """LLM provider configuration for provider metadata.

    Stores metadata about LLM providers (Anthropic, OpenAI, Google, Ollama, etc.)
    including branding, documentation URLs, and capabilities.
    Admins can customize these via the admin panel.
    """

    __tablename__ = "llm_providers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # Branding
    icon: Mapped[str | None] = mapped_column(String(50))  # Icon name (e.g., "Brain", "Sparkles")
    color: Mapped[str | None] = mapped_column(String(20))  # Brand color (e.g., "#D97757")
    logo_url: Mapped[str | None] = mapped_column(Text)  # URL to provider logo
    # Configuration
    is_local: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    default_url: Mapped[str | None] = mapped_column(String(500))  # Default API URL
    docs_url: Mapped[str | None] = mapped_column(String(500))  # Documentation URL
    setup_guide_url: Mapped[str | None] = mapped_column(String(500))  # Setup guide URL
    # Capabilities
    requires_api_key: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_streaming: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_tools: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_vision: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Status
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    # Timestamps
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
    # Provider: vertex, anthropic, openai, ollama
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Model family: anthropic, llama, titan, gemini, openai
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


class AuditLog(Base):
    """Audit log for tracking security-relevant actions.

    Tracks authentication, data access, file operations, admin actions,
    and other security-relevant events for compliance and debugging.
    """

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Who performed the action
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    user_email: Mapped[str | None] = mapped_column(String(255))  # Denormalized for retention

    # Session context (if applicable)
    session_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        index=True,
    )

    # Action classification
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # e.g., auth.login, auth.logout, file.write, agent.created, admin.settings_changed
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # e.g., auth, file, agent, session, billing, admin

    # Resource affected
    resource_type: Mapped[str | None] = mapped_column(String(50), index=True)
    # e.g., user, session, file, agent, setting
    resource_id: Mapped[str | None] = mapped_column(String(255))

    # Outcome
    status: Mapped[str] = mapped_column(
        String(20), default="success", nullable=False, index=True
    )  # success, failure, denied

    # Action details (structured data)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {"email": "user@example.com", "method": "password"}

    # For update operations: before/after state
    changes: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {"before": {"name": "old"}, "after": {"name": "new"}}

    # Request context
    ip_address: Mapped[str | None] = mapped_column(String(45))  # IPv6 max length
    user_agent: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str | None] = mapped_column(String(50))
    request_path: Mapped[str | None] = mapped_column(String(500))
    request_method: Mapped[str | None] = mapped_column(String(10))

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )


class DataRetentionPolicy(Base):
    """Data retention policy configuration for SOC 2 compliance.

    Defines how long different types of data should be retained
    and when they should be archived or deleted.
    """

    __tablename__ = "data_retention_policies"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Policy identification
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    data_type: Mapped[str] = mapped_column(
        String(50), nullable=False, unique=True, index=True
    )  # e.g., audit_logs, sessions, messages, files

    # Retention settings
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False)  # Days to keep data
    archive_after_days: Mapped[int | None] = mapped_column(Integer)  # Days before archiving
    delete_after_archive_days: Mapped[int | None] = mapped_column(
        Integer
    )  # Days after archive to delete

    # Policy details
    description: Mapped[str | None] = mapped_column(Text)
    legal_basis: Mapped[str | None] = mapped_column(Text)  # Legal requirement for retention

    # Status
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Execution tracking
    last_executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    records_archived: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    records_deleted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Timestamps
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
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )


class AccessReview(Base):
    """Access review records for SOC 2 compliance.

    Tracks periodic reviews of user access rights and permissions.
    """

    __tablename__ = "access_reviews"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Review details
    review_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # user_access, admin_access, api_keys, integrations
    review_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    review_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Review status
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False, index=True
    )  # pending, in_progress, completed, cancelled

    # Target of review (if specific user)
    target_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )

    # Reviewer
    reviewer_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )

    # Review findings
    findings: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {users_reviewed: 50, changes_made: 5, issues_found: 2, details: [...]}

    # Actions taken
    actions_taken: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    # e.g., [{action: "revoke_access", user_id: "...", resource: "..."}, ...]

    notes: Mapped[str | None] = mapped_column(Text)

    # Timestamps
    initiated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DataExportRequest(Base):
    """Data export request for GDPR/CCPA compliance.

    Tracks user requests to export their personal data.
    """

    __tablename__ = "data_export_requests"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Requesting user
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Request details
    request_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # export_data, delete_account, data_portability
    data_categories: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False
    )  # ["profile", "sessions", "messages", "files", "billing"]

    # Status tracking
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False, index=True
    )  # pending, processing, completed, failed, cancelled

    # Processing details
    processed_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    error_message: Mapped[str | None] = mapped_column(Text)

    # Export file info
    export_file_path: Mapped[str | None] = mapped_column(String(500))
    export_file_size_bytes: Mapped[int | None] = mapped_column(Integer)
    download_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CustomLLMProvider(Base):
    """Custom LLM provider configuration for private/self-hosted models.

    Allows users to connect their own LLM endpoints (vLLM, text-generation-inference,
    LocalAI, or any OpenAI-compatible API).
    """

    __tablename__ = "custom_llm_providers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Owner
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Provider identification
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # openai_compatible, anthropic_compatible, custom

    # Connection details
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    api_key: Mapped[str | None] = mapped_column(Text)  # Should be encrypted in production
    auth_header: Mapped[str] = mapped_column(String(50), default="Authorization", nullable=False)
    auth_scheme: Mapped[str] = mapped_column(String(50), default="Bearer", nullable=False)

    # Model configuration
    default_model: Mapped[str] = mapped_column(String(100), nullable=False)
    available_models: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    # Capabilities
    context_window: Mapped[int] = mapped_column(Integer, default=4096, nullable=False)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=2048, nullable=False)
    supports_streaming: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_tools: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_vision: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Request configuration
    request_timeout_seconds: Mapped[int] = mapped_column(Integer, default=120, nullable=False)
    extra_headers: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    extra_body_params: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Status
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_test_status: Mapped[str | None] = mapped_column(String(20))  # success, failure
    last_test_error: Mapped[str | None] = mapped_column(Text)

    # Timestamps
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


class ProductivityMetric(Base):
    """Daily productivity metrics for users.

    Tracks coding activity, agent usage, and estimated time saved
    for the productivity dashboard.
    """

    __tablename__ = "productivity_metrics"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # User and date
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
    )

    # Code changes
    lines_written: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lines_deleted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    files_modified: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    commits_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Agent usage
    agent_messages_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    agent_suggestions_accepted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    agent_suggestions_rejected: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    agent_tasks_completed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Time tracking
    active_session_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    coding_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    estimated_time_saved_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Breakdowns (JSON for flexibility)
    language_breakdown: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {"python": 500, "typescript": 300, "rust": 100}
    agent_usage_breakdown: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {"coder": 50, "reviewer": 20, "debugger": 10}

    # Streaks
    current_streak_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    longest_streak_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Timestamps
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


class ProjectHealthScore(Base):
    """Project health score tracking for workspaces/sessions.

    Analyzes code quality, test coverage, security, documentation,
    and dependencies to provide an overall project health score.
    """

    __tablename__ = "project_health_scores"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)

    # Reference to session/workspace
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Overall score (0-100)
    overall_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    grade: Mapped[str] = mapped_column(String(2), default="F", nullable=False)  # A, B, C, D, F

    # Individual metric scores (0-100 each)
    code_quality_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    test_coverage_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    security_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    documentation_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    dependency_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Detailed metrics (JSONB for flexibility)
    code_quality_details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {"linting_errors": 5, "complexity_issues": 2, "duplication_percent": 3.5}
    test_coverage_details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {"line_coverage": 85.2, "branch_coverage": 72.1, "test_count": 45}
    security_details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {"vulnerabilities": [], "secrets_found": 0, "outdated_deps": 3}
    documentation_details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {"has_readme": True, "api_docs_coverage": 65.0, "inline_comments": 12.5}
    dependency_details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # e.g., {"total_deps": 42, "outdated": 5, "deprecated": 1, "security_issues": 0}

    # Recommendations - list of dicts with id, type, title, description, priority fields
    recommendations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)

    # Analysis metadata
    analyzed_files_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    analysis_duration_seconds: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    analysis_status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )  # pending, running, completed, failed
    analysis_error: Mapped[str | None] = mapped_column(Text)

    # Trend tracking
    previous_overall_score: Mapped[int | None] = mapped_column(Integer)
    score_change: Mapped[int | None] = mapped_column(Integer)  # positive = improved

    # Timestamps
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
