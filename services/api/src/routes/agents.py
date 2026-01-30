"""Agent management routes."""

from __future__ import annotations

# ruff: noqa: I001

import re
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Annotated, Any, cast
from uuid import uuid4

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from podex_shared import generate_tts_summary
from src.agent_client import agent_client
from src.audit_logger import AuditAction, AuditLogger
from src.config import settings
from src.cache import cache_delete, user_config_key
from src.database import Agent as AgentModel
from src.database import (
    AgentTemplate,
    LLMModel,
    PlatformSetting,
    SessionCollaborator,
    SubscriptionPlan,
    UserConfig,
    UserSubscription,
)
from src.database import Session as SessionModel
from src.database.connection import async_session_factory
from src.database.models import ConversationMessage, ConversationSession, UserOAuthToken
from src.exceptions import (
    AgentClientError,
    EmptyMessageContentError,
    InvalidAgentRoleError,
    MessageContentTooLargeError,
)
from src.mcp_config import get_effective_mcp_config
from src.middleware.rate_limit import RATE_LIMIT_AGENT, RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id, verify_session_access
from src.routes.sessions import update_workspace_activity
from src.websocket.hub import (
    AgentAttentionInfo,
    emit_agent_attention,
    emit_agent_stream_start,
    emit_to_session,
)

logger = structlog.get_logger()

router = APIRouter()


@dataclass
class CommonDeps:
    """Common dependencies shared across routes."""

    request: Request
    db: AsyncSession


async def get_common_deps(request: Request, db: DbSession) -> CommonDeps:
    """Create common dependencies from request and db session."""
    return CommonDeps(request=request, db=db)


# Type alias for common dependencies
CommonDepsAnnotated = Annotated[CommonDeps, Depends(get_common_deps)]


class AgentRole(str, Enum):
    """Valid agent roles."""

    ARCHITECT = "architect"
    CODER = "coder"
    REVIEWER = "reviewer"
    TESTER = "tester"
    AGENT_BUILDER = "agent_builder"
    ORCHESTRATOR = "orchestrator"
    CHAT = "chat"
    SECURITY = "security"
    DEVOPS = "devops"
    DOCUMENTATOR = "documentator"
    CUSTOM = "custom"


class AgentMode(str, Enum):
    """Agent operation modes with different permission levels."""

    PLAN = "plan"  # Read-only: analyze codebase, no edits
    ASK = "ask"  # Requires approval for file edits and commands
    AUTO = "auto"  # Auto file edits, commands require allowlist or approval
    SOVEREIGN = "sovereign"  # Full access: all operations allowed


# Valid agent roles as a set for quick validation
VALID_AGENT_ROLES = {role.value for role in AgentRole}
VALID_AGENT_MODES = {mode.value for mode in AgentMode}

# Constants for attention message extraction
MIN_SENTENCE_LENGTH = 20  # Minimum characters for a meaningful sentence
MAX_SNIPPET_LENGTH = 150  # Maximum characters for attention message snippet

# Dangerous command patterns that should never be allowed in command_allowlist
FORBIDDEN_COMMAND_PATTERNS = {
    "*",  # Allow everything
    "/*",  # Allow all absolute paths
    "sudo *",  # Allow all sudo commands
    "rm -rf *",  # Allow destructive deletions
    "rm -rf /",  # Extremely dangerous
    "rm -rf /*",  # Extremely dangerous
    "> /dev/*",  # Writing to device files
    "curl * | *",  # Arbitrary command execution
    "wget * | *",  # Arbitrary command execution
    "eval *",  # Arbitrary code execution
    "exec *",  # Arbitrary code execution
    "$(*))",  # Command substitution
    "`*`",  # Command substitution
}


def sanitize_error_for_client(error: Exception | str, max_length: int = 200) -> str:
    """Sanitize an error message for client consumption.

    Removes potentially sensitive information like:
    - File paths
    - Database connection strings
    - Stack traces
    - Environment variables
    - Secrets/tokens

    Args:
        error: The error to sanitize
        max_length: Maximum length of returned message

    Returns:
        A sanitized error message safe for client display
    """
    error_str = str(error)

    # Patterns that might contain sensitive info
    sensitive_patterns = [
        r"postgresql://[^\s]+",  # Database URLs
        r"redis://[^\s]+",  # Redis URLs
        r"https?://[^\s]*:[^\s@]*@",  # URLs with credentials
        r"/Users/[^\s]+",  # Local file paths
        r"/home/[^\s]+",  # Linux home paths
        r"C:\\[^\s]+",  # Windows paths
        r"(api[_-]?key|secret|password|token)[=:][^\s]+",  # Secrets
        r"Bearer [A-Za-z0-9._-]+",  # JWT tokens
        r"Traceback \(most recent call last\):",  # Stack traces
        r"File \"[^\"]+\", line \d+",  # Stack trace lines
    ]

    sanitized = error_str
    for pattern in sensitive_patterns:
        sanitized = re.sub(pattern, "[REDACTED]", sanitized, flags=re.IGNORECASE)

    # Truncate to max length
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length] + "..."

    # If entirely redacted or empty, return generic message
    if not sanitized.strip() or sanitized == "[REDACTED]":
        return "An error occurred while processing your request"

    return sanitized


def _normalize_command_pattern(pattern: str) -> str:
    """Normalize a command pattern for consistent comparison.

    Normalizes whitespace and case for security validation.

    Args:
        pattern: The command pattern to normalize.

    Returns:
        Normalized pattern string.
    """
    # Strip leading/trailing whitespace
    normalized = pattern.strip()
    # Collapse multiple spaces into single space
    normalized = " ".join(normalized.split())
    # Lowercase for case-insensitive comparison
    return normalized.lower()


def validate_command_allowlist(allowlist: list[str] | None) -> list[str] | None:
    """Validate command allowlist patterns for safety.

    Args:
        allowlist: List of command patterns to validate

    Returns:
        The validated allowlist

    Raises:
        ValueError: If any pattern is forbidden or too broad
    """
    if not allowlist:
        return allowlist

    # Pre-normalize forbidden patterns for comparison
    forbidden_normalized = {_normalize_command_pattern(p) for p in FORBIDDEN_COMMAND_PATTERNS}

    validated = []
    for pattern in allowlist:
        # Normalize the pattern for validation
        normalized = _normalize_command_pattern(pattern)
        original_stripped = pattern.strip()

        # Check for forbidden patterns (normalized comparison)
        if normalized in forbidden_normalized:
            raise ValueError(f"Forbidden pattern: {original_stripped}")  # noqa: TRY003

        # Check for overly broad wildcards
        if normalized == "*" or normalized.startswith("* "):
            raise ValueError("Wildcard-only patterns not allowed")  # noqa: TRY003

        # Check for shell injection patterns
        if any(c in original_stripped for c in ["|", ";", "&&", "||", "`", "$("]):
            raise ValueError(f"Shell operators not allowed: {original_stripped}")  # noqa: TRY003

        validated.append(original_stripped)

    return validated


async def check_session_collaborator_access(
    session_id: str,
    request: Request,
    db: AsyncSession,
) -> SessionModel:
    """Verify the current user has access to the session.

    Access is granted if:
    - User is the session owner, OR
    - User is a collaborator on the session

    Raises:
        HTTPException: If session not found or user lacks access.
    """
    user_id = get_current_user_id(request)

    session_query = select(SessionModel).where(SessionModel.id == session_id)
    session_result = await db.execute(session_query)
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check if user is owner
    if session.owner_id == user_id:
        return session

    # Check if user is a collaborator
    collaborator_query = select(SessionCollaborator).where(
        SessionCollaborator.session_id == session_id,
        SessionCollaborator.user_id == user_id,
    )
    collaborator_result = await db.execute(collaborator_query)
    collaborator = collaborator_result.scalar_one_or_none()

    if collaborator:
        return session

    raise HTTPException(status_code=403, detail="Access denied")


async def check_agent_quota(db: AsyncSession, user_id: str, session_id: str) -> None:
    """Check if user has reached their agent quota for a session.

    Uses SELECT FOR UPDATE with NOWAIT on the session row to prevent race conditions
    where concurrent requests could exceed the quota. The lock serializes all
    concurrent agent creation requests for the same session.

    Args:
        db: Database session
        user_id: User ID to check
        session_id: Session ID where agent will be created

    Raises:
        HTTPException: If user has exceeded their agent quota or lacks a valid subscription
    """
    from sqlalchemy.exc import OperationalError

    try:
        # Lock the session row with NOWAIT to fail fast on contention
        # This prevents race conditions where multiple requests could exceed the quota
        # Using NOWAIT ensures we don't wait indefinitely on a locked row
        session_lock_query = (
            select(SessionModel).where(SessionModel.id == session_id).with_for_update(nowait=True)
        )
        lock_result = await db.execute(session_lock_query)
        session = lock_result.scalar_one_or_none()
    except OperationalError:
        # Lock acquisition failed - another request is creating an agent
        raise HTTPException(
            status_code=409,
            detail="Another agent creation is in progress. Please try again.",
        ) from None

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get user's active subscription and plan
    sub_query = (
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
        .order_by(UserSubscription.created_at.desc())
        .limit(1)
    )
    sub_result = await db.execute(sub_query)
    subscription = sub_result.scalar_one_or_none()

    if not subscription:
        raise HTTPException(
            status_code=403,
            detail="No active subscription found. Please contact support.",
        )

    # Get plan limits
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id)
    )
    plan = plan_result.scalar_one_or_none()

    if not plan:
        raise HTTPException(
            status_code=500,
            detail="Subscription plan not found. Please contact support.",
        )

    max_agents = plan.max_agents

    # Count current agents in this session (within the lock)
    # The lock ensures this count is accurate and won't change until we commit
    count_query = (
        select(func.count()).select_from(AgentModel).where(AgentModel.session_id == session_id)
    )
    count_result = await db.execute(count_query)
    current_agents = count_result.scalar() or 0

    if current_agents >= max_agents:
        raise HTTPException(
            status_code=403,
            detail=f"Agent quota exceeded. You have {current_agents} agents in this session "
            f"and your plan allows {max_agents}. Please remove existing agents or "
            "upgrade your plan.",
        )


class AgentCreate(BaseModel):
    """Create agent request."""

    name: str
    role: str  # Validated: architect, coder, reviewer, tester, agent_builder, custom
    model: str | None = None  # Optional - uses role default from platform settings if not provided
    mode: str = "ask"  # plan, ask, auto, sovereign
    command_allowlist: list[str] | None = None  # Allowed commands for Auto mode
    config: dict[str, Any] | None = None
    template_id: str | None = None  # Reference to custom agent template

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        """Validate role is a valid AgentRole enum value."""
        role_lower = v.lower()
        if role_lower not in VALID_AGENT_ROLES:
            raise InvalidAgentRoleError(v, list(VALID_AGENT_ROLES))
        return role_lower

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        """Validate mode is a valid AgentMode enum value."""
        mode_lower = v.lower()
        if mode_lower not in VALID_AGENT_MODES:
            raise ValueError("Invalid agent mode")  # noqa: TRY003
        return mode_lower


class AgentResponse(BaseModel):
    """Agent response."""

    id: str
    session_id: str
    name: str
    role: str
    model: str
    model_display_name: str | None = None  # User-friendly model name from database
    status: str
    mode: str = "ask"  # plan, ask, auto, sovereign
    command_allowlist: list[str] | None = None
    config: dict[str, Any] | None = None
    template_id: str | None = None
    conversation_session_id: str | None = None  # ID of attached conversation session
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AgentModeUpdate(BaseModel):
    """Update agent mode request."""

    mode: str
    command_allowlist: list[str] | None = None

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        """Validate mode is a valid AgentMode enum value."""
        mode_lower = v.lower()
        if mode_lower not in VALID_AGENT_MODES:
            raise ValueError("Invalid agent mode")  # noqa: TRY003
        return mode_lower


class AgentUpdate(BaseModel):
    """Update agent settings request."""

    name: str | None = None
    model: str | None = None


class ImageAttachment(BaseModel):
    """Image attachment for agent messages."""

    type: str = "image"  # image, screenshot, file
    url: str | None = None  # URL to image in workspace
    base64_data: str | None = None  # Base64 encoded image data
    content_type: str = "image/png"  # MIME type
    filename: str | None = None  # Original filename


class ThinkingConfigRequest(BaseModel):
    """Extended thinking configuration for agent messages."""

    enabled: bool = False
    budget_tokens: int = 8000  # Default budget (min 1024, max 32000)

    @field_validator("budget_tokens")
    @classmethod
    def validate_budget(cls, v: int) -> int:
        """Validate thinking budget is within allowed range."""
        min_budget = 1024
        max_budget = 32000
        if v < min_budget:
            return min_budget
        if v > max_budget:
            return max_budget
        return v


class BrowserConsoleLog(BaseModel):
    """Browser console log entry for context."""

    level: str  # 'log', 'warn', 'error', 'info', 'debug'
    message: str
    timestamp: str
    source: str | None = None


class BrowserNetworkLog(BaseModel):
    """Browser network request entry for context."""

    url: str
    method: str
    status: int
    status_text: str | None = None
    duration: int | None = None  # milliseconds
    error: str | None = None
    type: str = "fetch"  # 'fetch' or 'xhr'


class BrowserErrorLog(BaseModel):
    """Browser error entry for context."""

    type: str  # 'js_error', 'unhandled_rejection', 'network_error'
    message: str
    stack: str | None = None
    timestamp: str


class BrowserContextMetadata(BaseModel):
    """Browser context metadata."""

    user_agent: str | None = None
    viewport_size: dict[str, int] | None = None  # { width, height }


class BrowserContext(BaseModel):
    """Browser context data for debugging assistance.

    Contains console logs, network requests, errors, and optional HTML snapshot
    from the preview iframe to help agents debug frontend issues.
    """

    url: str
    title: str | None = None
    timestamp: str
    console_logs: list[BrowserConsoleLog] | None = None
    network_requests: list[BrowserNetworkLog] | None = None
    errors: list[BrowserErrorLog] | None = None
    html_snapshot: str | None = None
    metadata: BrowserContextMetadata | None = None

    @field_validator("html_snapshot")
    @classmethod
    def validate_html_snapshot(cls, v: str | None) -> str | None:
        """Truncate HTML snapshot if too large (max 50KB)."""
        if v is None:
            return v
        max_size = 50 * 1024  # 50KB
        if len(v.encode("utf-8")) > max_size:
            return v[:max_size] + "\n<!-- truncated -->"
        return v

    @field_validator("console_logs")
    @classmethod
    def validate_console_logs(
        cls, v: list[BrowserConsoleLog] | None
    ) -> list[BrowserConsoleLog] | None:
        """Limit console logs to last 50 entries."""
        if v is None:
            return v
        return v[-50:]

    @field_validator("network_requests")
    @classmethod
    def validate_network_requests(
        cls, v: list[BrowserNetworkLog] | None
    ) -> list[BrowserNetworkLog] | None:
        """Limit network requests to last 30 entries."""
        if v is None:
            return v
        return v[-30:]

    @field_validator("errors")
    @classmethod
    def validate_errors(cls, v: list[BrowserErrorLog] | None) -> list[BrowserErrorLog] | None:
        """Limit errors to last 20 entries."""
        if v is None:
            return v
        return v[-20:]


class MessageCreate(BaseModel):
    """Create message request."""

    content: str
    images: list[ImageAttachment] | None = None  # Optional image attachments
    thinking_config: ThinkingConfigRequest | None = None  # Extended thinking config
    browser_context: BrowserContext | None = None  # Browser debugging context
    # Claude Code session ID for conversation continuity
    # Optional: if provided, overrides the agent config value
    claude_session_id: str | None = None

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        """Validate message content size (max 100KB)."""
        max_size = 100 * 1024  # 100KB
        if len(v.encode("utf-8")) > max_size:
            raise MessageContentTooLargeError(max_size // 1024)
        if not v.strip():
            raise EmptyMessageContentError
        return v

    @field_validator("images")
    @classmethod
    def validate_images(cls, v: list[ImageAttachment] | None) -> list[ImageAttachment] | None:
        """Validate images (max 5 images, max 10MB each)."""
        if not v:
            return v
        max_images = 5
        max_size = 10 * 1024 * 1024  # 10MB per image
        if len(v) > max_images:
            raise ValueError("Too many images")  # noqa: TRY003
        for img in v:
            if img.base64_data:
                # Remove data URL prefix for size calculation
                data = img.base64_data
                if data.startswith("data:"):
                    data = data.split(",", 1)[1] if "," in data else data
                # Base64 is ~4/3 the size of binary
                estimated_size = len(data) * 3 // 4
                if estimated_size > max_size:
                    raise ValueError("Image too large")  # noqa: TRY003
        return v


class MessageResponse(BaseModel):
    """Message response."""

    id: str
    agent_id: str
    role: str
    content: str
    tool_calls: dict[str, Any] | None = None
    images: list[dict[str, Any]] | None = None  # Image attachments if any
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


@dataclass
class PaginationParams:
    """Pagination parameters for list endpoints."""

    limit: int = 100
    offset: int = 0
    # Cursor for cursor-based pagination (message ID)
    # When provided, offset is ignored and results start after this message
    cursor: str | None = None

    def __post_init__(self) -> None:
        """Clamp values to valid ranges."""
        self.limit = min(max(1, self.limit), 500)
        self.offset = max(0, self.offset)


@dataclass
class SendMessageParams:
    """Path parameters and body for send_message endpoint."""

    session_id: str
    agent_id: str
    data: MessageCreate


@dataclass
class SendMessageDeps:
    """Dependencies for send_message endpoint."""

    common: CommonDeps
    background_tasks: BackgroundTasks


@dataclass
class GetMessagesParams:
    """Path and query parameters for get_messages endpoint."""

    session_id: str
    agent_id: str
    pagination: PaginationParams


# Agent colors for UI
AGENT_COLORS = ["#00e5ff", "#a855f7", "#22c55e", "#f59e0b", "#ec4899", "#eab308"]


async def get_model_display_name(db: AsyncSession, model_id: str) -> str | None:
    """Look up model display name from the database.

    Args:
        db: Database session
        model_id: The model ID to look up

    Returns:
        The display name if found, None otherwise
    """
    result = await db.execute(select(LLMModel.display_name).where(LLMModel.model_id == model_id))
    row = result.first()
    return row[0] if row else None


async def get_default_model_for_role(db: AsyncSession, role: str) -> str:
    """Get the default model for an agent role from platform settings.

    Args:
        db: Database session
        role: The agent role (e.g., 'chat', 'coder', 'architect')

    Returns:
        The default model ID for the role

    Raises:
        HTTPException: If no default model is configured for the role
    """
    result = await db.execute(
        select(PlatformSetting).where(PlatformSetting.key == "agent_model_defaults")
    )
    setting = result.scalar_one_or_none()

    if setting and setting.value and isinstance(setting.value, dict):
        defaults = setting.value
        if role in defaults and isinstance(defaults[role], dict) and "model_id" in defaults[role]:
            return str(defaults[role]["model_id"])

    raise HTTPException(
        status_code=500,
        detail=(
            f"No default model configured for role '{role}'. "
            "Check agent_model_defaults in platform settings."
        ),
    )


def _build_agent_response(
    agent: AgentModel, model_display_name: str | None = None
) -> AgentResponse:
    """Build AgentResponse from an Agent model.

    Args:
        agent: The agent model
        model_display_name: Optional pre-fetched display name

    Returns:
        AgentResponse with all fields populated
    """
    # Get conversation_session_id from the attached_conversation relationship
    conversation_session_id = None
    if agent.attached_conversation:
        conversation_session_id = agent.attached_conversation.id

    return AgentResponse(
        id=agent.id,
        session_id=agent.session_id,
        name=agent.name,
        role=agent.role,
        model=agent.model,
        model_display_name=model_display_name,
        status=agent.status,
        mode=agent.mode,
        command_allowlist=agent.command_allowlist,
        config=agent.config,
        template_id=agent.template_id,
        conversation_session_id=conversation_session_id,
        created_at=agent.created_at,
    )


async def _user_has_model_access(
    db: AsyncSession,
    user_id: str,
    model_id: str,
) -> bool:
    """Check if the user has access to the given model.

    Access rules:
    - Platform models (is_user_key_model=False):
      - Must be enabled.
    - User-key models (is_user_key_model=True):
      - Must be enabled AND
      - User must have an API key configured for the provider OR
      - User must have an active OAuth token for the provider.
    - Local models (ollama/lmstudio):
      - Identified by model_id starting with "ollama/" or "lmstudio/".
      - Must exist in UserConfig.agent_preferences["local_llm_config"].
    """
    # First, try to resolve as a platform/user-key model
    result = await db.execute(
        select(LLMModel).where(
            LLMModel.model_id == model_id,
            LLMModel.is_enabled.is_(True),
        )
    )
    model = result.scalar_one_or_none()

    if model:
        if not model.is_user_key_model:
            # Platform-provided model, enabled => accessible
            return True

        # User-key model: require API key or OAuth token
        config_result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
        config = config_result.scalar_one_or_none()

        api_keys = (config.llm_api_keys or {}) if config and config.llm_api_keys else {}
        if model.provider in api_keys:
            return True

        # Check OAuth tokens
        oauth_result = await db.execute(
            select(UserOAuthToken).where(
                UserOAuthToken.user_id == user_id,
                UserOAuthToken.provider == model.provider,
                UserOAuthToken.status == "connected",
            )
        )
        oauth_token = oauth_result.scalar_one_or_none()
        return oauth_token is not None

    # If no LLMModel row, treat as potential local model (ollama/lmstudio)
    if "/" in model_id:
        provider, local_id = model_id.split("/", 1)
        if provider in {"ollama", "lmstudio"}:
            config_result = await db.execute(
                select(UserConfig).where(UserConfig.user_id == user_id)
            )
            config = config_result.scalar_one_or_none()
            prefs = (config.agent_preferences or {}) if config and config.agent_preferences else {}
            local_cfg = prefs.get("local_llm_config") or {}
            provider_cfg = local_cfg.get(provider) or {}
            models = provider_cfg.get("models") or []
            # Stored models use "id" as tag; agent model_id is "provider/name"
            return any(m.get("id") == local_id for m in models)

    return False


async def _get_user_model_default_for_role(
    db: AsyncSession,
    user_id: str,
    role: str,
) -> str | None:
    """Get the user's preferred default model for a role, if accessible.

    Reads UserConfig.agent_preferences["model_defaults"][role] and verifies that
    the user still has access to that model. If not accessible, returns None
    without mutating the stored preference (so it can be reused if access is restored).
    """
    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()
    if not config or not config.agent_preferences:
        return None

    prefs = config.agent_preferences or {}
    model_defaults = prefs.get("model_defaults") or {}
    if not isinstance(model_defaults, dict):
        return None

    model_id = model_defaults.get(role)
    if not isinstance(model_id, str) or not model_id:
        return None

    if await _user_has_model_access(db, user_id, model_id):
        return model_id

    # Preference exists but is no longer accessible - ignore it for this request
    return None


# ==================== Agent Attention Detection ====================

# Patterns that indicate the agent needs user approval
# Patterns are anchored to reduce false positives (match at sentence boundaries)
APPROVAL_PATTERNS = [
    # Direct approval requests - sentence start or after punctuation
    r"(?:^|[.!?]\s*)(?:awaiting|waiting for) (?:your )?approval",
    r"(?:^|[.!?]\s*)please (?:review|approve|confirm)\b",
    # Questions at end of response or sentence
    r"shall I proceed\?(?:\s*$|\s*[.!])",
    r"do you want me to (?:proceed|continue|go ahead)\?(?:\s*$|\s*[.!])",
    r"would you like me to (?:proceed|continue|go ahead|implement|execute)\?(?:\s*$|\s*[.!])",
    r"ready to (?:proceed|implement|execute)[^.]*\?(?:\s*$|\s*[.!])",
    # Before-action statements
    r"(?:^|[.!?]\s*)before I (?:proceed|continue|start)",
    r"(?:^|[.!?]\s*)let me know (?:if|when) (?:you'?re ready|I should)",
    r"(?:^|[.!?]\s*)approve (?:this|the) plan",
]

# Patterns that indicate task completion
# More specific patterns to avoid false positives
COMPLETION_PATTERNS = [
    # Direct completion statements at sentence start
    r"(?:^|[.!?]\s*)I'?ve (?:completed|finished|done|implemented)\b",
    r"(?:^|[.!?]\s*)implementation is (?:done|complete|finished)\b",
    r"(?:^|[.!?]\s*)all (?:tests|files|changes) (?:are )?(?:done|complete|passing)\b",
    r"(?:^|[.!?]\s*)(?:the )?task (?:is )?(?:complete|done|finished)\b",
    r"(?:^|[.!?]\s*)successfully (?:completed|implemented|created|fixed)\b",
    r"(?:^|[.!?]\s*)(?:the )?changes have been (?:made|applied|committed)\b",
    r"(?:^|[.!?]\s*)everything (?:is )?(?:set up|configured|ready)\b",
]

# Patterns that indicate waiting for user input
# More specific to reduce false positives in explanatory text
INPUT_PATTERNS = [
    # Direct questions to user
    r"(?:^|[.!?]\s*)what would you like\b",
    r"(?:^|[.!?]\s*)please (?:provide|specify|tell me|share|clarify)\b",
    r"(?:^|[.!?]\s*)I need (?:more information|clarification|details|your input)\b",
    r"(?:^|[.!?]\s*)which (?:option|approach|method) would you prefer\?",
    # Direct questions that end with question mark
    r"can you (?:provide|specify|clarify|share)[^?]*\?(?:\s*$|\s*[.!])",
    r"could you (?:provide|specify|clarify|share|tell me)[^?]*\?(?:\s*$|\s*[.!])",
    r"what (?:should|would) you like me to[^?]*\?(?:\s*$|\s*[.!])",
    r"how would you like me to[^?]*\?(?:\s*$|\s*[.!])",
]


def detect_attention_type(response: str, _agent_role: str) -> str | None:
    """Detect if an agent response requires user attention.

    Uses anchored patterns to reduce false positives. Patterns match at
    sentence boundaries to avoid matching explanatory text.

    Args:
        response: The agent's response content.
        _agent_role: The agent's role (architect, coder, etc.). Reserved for future use.

    Returns:
        The attention type if attention is needed, None otherwise.
        Priority: needs_approval > waiting_input > completed
    """
    response_lower = response.lower()

    # Check for approval patterns (highest priority)
    for pattern in APPROVAL_PATTERNS:
        if re.search(pattern, response_lower, re.IGNORECASE | re.MULTILINE):
            return "needs_approval"

    # Check for input patterns (second priority - user action needed)
    for pattern in INPUT_PATTERNS:
        if re.search(pattern, response_lower, re.IGNORECASE | re.MULTILINE):
            return "waiting_input"

    # Check for completion patterns (lowest priority - informational)
    for pattern in COMPLETION_PATTERNS:
        if re.search(pattern, response_lower, re.IGNORECASE | re.MULTILINE):
            return "completed"

    return None


def get_attention_title(attention_type: str, agent_name: str, _agent_role: str) -> str:
    """Generate a title for the attention notification.

    Args:
        attention_type: Type of attention (needs_approval, completed, error, waiting_input).
        agent_name: Display name of the agent.
        _agent_role: Role of the agent. Reserved for future use.

    Returns:
        A concise title for the notification.
    """
    titles = {
        "needs_approval": f"{agent_name} needs your approval",
        "completed": f"{agent_name} completed a task",
        "error": f"{agent_name} encountered an error",
        "waiting_input": f"{agent_name} needs your input",
    }
    return titles.get(attention_type, f"{agent_name} needs attention")


def get_attention_message(attention_type: str, response: str, _agent_role: str) -> str:
    """Generate a message summarizing why attention is needed.

    Args:
        attention_type: Type of attention.
        response: The agent's response content.
        _agent_role: Role of the agent. Reserved for future use.

    Returns:
        A brief message describing the attention request.
    """
    # Extract a relevant snippet from the response (first meaningful sentence)
    sentences = re.split(r"[.!?\n]", response)
    first_sentence = ""
    for sentence in sentences:
        stripped = sentence.strip()
        if len(stripped) > MIN_SENTENCE_LENGTH:  # Skip very short fragments
            suffix = "..." if len(stripped) > MAX_SNIPPET_LENGTH else ""
            first_sentence = stripped[:MAX_SNIPPET_LENGTH] + suffix
            break

    messages = {
        "needs_approval": first_sentence or "Review and approve the proposed changes.",
        "completed": first_sentence or "The task has been completed successfully.",
        "error": first_sentence or "An error occurred during processing.",
        "waiting_input": first_sentence or "Additional information is required to proceed.",
    }
    return messages.get(attention_type, "Agent requires your attention.")


def get_attention_priority(attention_type: str, _agent_role: str) -> str:
    """Determine the priority level for an attention notification.

    Args:
        attention_type: Type of attention.
        _agent_role: Role of the agent. Reserved for future use.

    Returns:
        Priority level (low, medium, high, critical).
    """
    # Error and approval requests are high priority
    if attention_type == "error":
        return "high"
    if attention_type == "needs_approval":
        return "high"
    if attention_type == "completed":
        return "medium"
    if attention_type == "waiting_input":
        return "medium"
    return "low"


def _generate_agent_response(agent_role: str, user_message: str) -> str:
    """Generate a simulated agent response based on role.

    In production, this would integrate with an LLM API.
    """
    if agent_role == "architect":
        return (
            f'I\'ve analyzed your request: "{user_message}"\n\n'
            "Here's my architectural recommendation:\n\n"
            "1. **Analysis**: This appears to be a feature request that will "
            "require changes across multiple components.\n"
            "2. **Approach**: I recommend breaking this down into smaller tasks.\n"
            "3. **Next Steps**: Would you like me to create a detailed "
            "implementation plan?"
        )
    if agent_role == "coder":
        return (
            f'I understand you want me to work on: "{user_message}"\n\n'
            "I'll implement this following best practices. Here's my approach:\n\n"
            "```typescript\n"
            "// Implementation placeholder\n"
            "function example() {\n"
            "  // Your logic here\n"
            "}\n"
            "```\n\n"
            "Shall I proceed with the full implementation?"
        )
    if agent_role == "reviewer":
        return (
            f'I\'ll review the code related to: "{user_message}"\n\n'
            "**Initial observations:**\n"
            "- Code structure looks good\n"
            "- Consider adding error handling\n"
            "- Tests should be added for edge cases\n\n"
            "Would you like a detailed review?"
        )
    if agent_role == "tester":
        return (
            f'I\'ll create tests for: "{user_message}"\n\n'
            "**Test plan:**\n"
            "1. Unit tests for core functionality\n"
            "2. Integration tests for API endpoints\n"
            "3. Edge case coverage\n\n"
            "Shall I generate the test files?"
        )
    return f'I\'ve received your message: "{user_message}"\n\nHow can I help you with this?'


@dataclass
class AgentMessageContext:
    """Context for processing an agent message."""

    session_id: str
    agent_id: str
    agent_name: str
    agent_role: str
    agent_model: str
    user_message: str
    # Conversation session ID for the portable conversation system
    conversation_session_id: str | None = None
    # Model's registered provider from database (anthropic, openai, vertex, ollama, etc.)
    model_provider: str | None = None
    agent_config: dict[str, Any] | None = None
    user_id: str | None = None
    # MCP config will be populated during processing (async DB lookup)
    mcp_config: dict[str, Any] | None = None
    # Mode and command_allowlist for permission checking
    agent_mode: str | None = None
    command_allowlist: list[str] | None = None
    # Image attachments for vision models
    images: list[dict[str, Any]] | None = None
    # Extended thinking configuration
    thinking_config: dict[str, Any] | None = None
    # User-provided LLM API keys for external providers
    llm_api_keys: dict[str, str] | None = None
    # Workspace ID for workspace-based MCP servers
    workspace_id: str | None = None
    # Browser context for debugging assistance
    browser_context: dict[str, Any] | None = None
    # Claude Code session ID for conversation continuity (passed from request)
    claude_session_id: str | None = None


def _build_agent_service_context(
    ctx: AgentMessageContext,
    message_id: str | None = None,
) -> dict[str, Any]:
    """Build context dictionary for agent service call."""
    agent_context: dict[str, Any] = {
        "role": ctx.agent_role,
        "model": ctx.agent_model,
    }
    # Pass the model's registered provider from the database
    if ctx.model_provider:
        agent_context["model_provider"] = ctx.model_provider
    if ctx.user_id:
        agent_context["user_id"] = ctx.user_id
    if ctx.agent_config and "template_config" in ctx.agent_config:
        agent_context["template_config"] = ctx.agent_config["template_config"]
    # Include MCP config for the agent service to connect MCP servers
    if ctx.mcp_config:
        agent_context["mcp_config"] = ctx.mcp_config
    # Include mode and command_allowlist for permission checking
    if ctx.agent_mode:
        agent_context["mode"] = ctx.agent_mode
    if ctx.command_allowlist:
        agent_context["command_allowlist"] = ctx.command_allowlist
    # Include image attachments for vision models
    if ctx.images:
        agent_context["images"] = ctx.images
    # Include extended thinking config if provided
    if ctx.thinking_config:
        agent_context["thinking_config"] = ctx.thinking_config
    # Include user-provided LLM API keys (for external providers)
    if ctx.llm_api_keys:
        agent_context["llm_api_keys"] = ctx.llm_api_keys
    # Include workspace_id for remote tool execution on workspace container
    if ctx.workspace_id:
        agent_context["workspace_id"] = ctx.workspace_id
    # Include browser context for debugging assistance
    if ctx.browser_context:
        agent_context["browser_context"] = ctx.browser_context
    # Include message_id to enable streaming via Redis Pub/Sub
    if message_id:
        agent_context["message_id"] = message_id
        agent_context["stream"] = True
    return agent_context


async def _notify_agent_status(
    session_id: str,
    agent_id: str,
    status: str,
    error: str | None = None,
) -> None:
    """Emit agent status update to session."""
    data: dict[str, Any] = {
        "agent_id": agent_id,
        "status": status,
        "session_id": session_id,
    }
    if error:
        data["error"] = error
    await emit_to_session(session_id, "agent_status", data)


async def _emit_agent_response(
    ctx: AgentMessageContext,
    message: ConversationMessage,
    response_content: str,
    tts_summary: str | None,
    *,
    auto_play: bool,
    tool_calls: list[dict[str, Any]] | None = None,
) -> None:
    """Emit agent response message to session participants."""
    # Format tool calls for frontend - translate backend format to frontend expected format
    formatted_tool_calls = None
    if tool_calls:
        formatted_tool_calls = [
            {
                "id": tc.get("id", f"tc-{i}"),
                "name": tc.get("name", "unknown"),
                "args": tc.get("arguments", tc.get("args", {})),
                "result": tc.get("result"),
                "status": "completed" if tc.get("result") else "pending",
            }
            for i, tc in enumerate(tool_calls)
        ]

    await emit_to_session(
        ctx.session_id,
        "agent_message",
        {
            "id": message.id,
            "agent_id": ctx.agent_id,
            "agent_name": ctx.agent_name,
            "role": "assistant",
            "content": response_content,
            "session_id": ctx.session_id,
            "created_at": message.created_at.isoformat(),
            "auto_play": auto_play,
            "tts_summary": tts_summary,
            "tool_calls": formatted_tool_calls,
        },
    )


@dataclass
class ResponseProcessingContext:
    """Context for processing and emitting agent response."""

    db: AsyncSession
    ctx: AgentMessageContext
    agent: AgentModel
    response_content: str
    auto_play: bool
    tool_calls: list[dict[str, Any]] | None = None
    streamed: bool = False  # If True, skip agent_message emit (frontend got it via streaming)
    message_id: str | None = None  # Optional message ID for streaming (to match frontend ID)
    tokens_used: int = 0  # Token count to update on agent


async def _process_and_emit_response(
    processing_ctx: ResponseProcessingContext,
) -> None:
    """Process agent response: create message, emit events, check attention.

    This function stages all database changes and commits them in a single transaction
    to ensure consistency. If any part fails, the entire transaction is rolled back.
    """
    db = processing_ctx.db
    ctx = processing_ctx.ctx
    agent = processing_ctx.agent
    response_content = processing_ctx.response_content
    auto_play = processing_ctx.auto_play
    tool_calls = processing_ctx.tool_calls

    tts_result = generate_tts_summary(response_content)
    tts_summary = tts_result.summary if tts_result.was_summarized else None

    # Use the provided message_id if available (for streaming), otherwise let DB generate one
    # Messages now belong to conversation sessions, not agents directly
    if not ctx.conversation_session_id:
        logger.warning("No conversation session for agent response", agent_id=ctx.agent_id)
        # Create a conversation session and attach it to the agent
        conversation = ConversationSession(
            session_id=ctx.session_id,
            name="New Session",
        )
        db.add(conversation)
        await db.flush()
        ctx.conversation_session_id = conversation.id
        # Attach conversation to agent via the junction table
        conversation.attached_agents.append(agent)

    assistant_message = ConversationMessage(
        id=processing_ctx.message_id,  # Will be None for non-streaming, triggering auto-generation
        conversation_session_id=ctx.conversation_session_id,
        role="assistant",
        content=response_content,
        tts_summary=tts_summary,
    )
    db.add(assistant_message)

    # Update conversation metadata
    conv_result = await db.execute(
        select(ConversationSession).where(ConversationSession.id == ctx.conversation_session_id)
    )
    conversation = cast("ConversationSession", conv_result.scalar_one_or_none())
    conversation.message_count += 1
    conversation.last_message_at = func.now()

    # Update agent status to idle
    agent.status = "idle"

    # Update token tracking if tokens were used
    if processing_ctx.tokens_used > 0:
        agent.context_tokens_used += processing_ctx.tokens_used

    # Flush to get message ID without committing
    await db.flush()
    await db.refresh(assistant_message)

    # Single commit for all database changes (message + agent status + tokens)
    await db.commit()

    # After successful commit, emit all events
    # Only emit agent_message if NOT streamed (streaming sends message via Redis pub/sub)
    if not processing_ctx.streamed:
        await _emit_agent_response(
            ctx,
            assistant_message,
            response_content,
            tts_summary,
            auto_play=auto_play,
            tool_calls=tool_calls,
        )
    await _notify_agent_status(ctx.session_id, ctx.agent_id, "idle")

    # Track productivity metrics (non-blocking, failures logged but don't affect response)
    if ctx.user_id:
        try:
            from src.services.productivity_tracking_service import ProductivityTrackingService

            tracker = ProductivityTrackingService(db)
            await tracker.track_agent_message(
                user_id=ctx.user_id,
                agent_role=ctx.agent_role,
                tokens_used=processing_ctx.tokens_used,
            )
        except Exception as e:
            logger.warning("Failed to track productivity metrics", error=str(e))

    # Emit token usage update if tokens were used
    if processing_ctx.tokens_used > 0:
        percentage = int((agent.context_tokens_used / agent.context_max_tokens) * 100)
        await emit_to_session(
            ctx.session_id,
            "context_usage_update",
            {
                "agent_id": ctx.agent_id,
                "tokens_used": agent.context_tokens_used,
                "tokens_max": agent.context_max_tokens,
                "percentage": percentage,
            },
        )

        # Check for auto-compaction if threshold exceeded
        # Import locally to avoid circular dependency
        from src.routes.context import maybe_trigger_auto_compaction

        if ctx.user_id:
            await maybe_trigger_auto_compaction(
                db=db,
                agent=agent,
                session_id=ctx.session_id,
                _user_id=ctx.user_id,
            )

    attention_type = detect_attention_type(response_content, ctx.agent_role)
    if attention_type:
        attention_info = AgentAttentionInfo(
            session_id=ctx.session_id,
            agent_id=ctx.agent_id,
            agent_name=ctx.agent_name,
            attention_type=attention_type,
            title=get_attention_title(attention_type, ctx.agent_name, ctx.agent_role),
            message=get_attention_message(
                attention_type,
                response_content,
                ctx.agent_role,
            ),
            priority=get_attention_priority(attention_type, ctx.agent_role),
            metadata={
                "response_id": assistant_message.id,
                "task_summary": response_content[:200],
            },
        )
        await emit_agent_attention(attention_info)


async def process_agent_message(ctx: AgentMessageContext) -> None:
    """Background task to process agent message and generate response.

    Calls the agent service to process the message with the LLM.
    Falls back to simulated responses in development if agent service unavailable.
    For Claude Code agents, uses the Claude Code executor via compute service.

    Args:
        ctx: The agent message context containing all required parameters.
    """
    # Create a new database session for the background task
    async with async_session_factory() as db:
        try:
            # Update agent status to running with row-level locking to prevent race conditions
            agent_query = select(AgentModel).where(AgentModel.id == ctx.agent_id).with_for_update()
            result = await db.execute(agent_query)
            agent = result.scalar_one_or_none()

            if not agent:
                logger.warning("Agent not found for message processing", agent_id=ctx.agent_id)
                return

            agent.status = "running"
            await db.commit()

            # Get voice config for auto-play
            voice_config = agent.voice_config or {}
            auto_play = voice_config.get("auto_play", False)

            # Notify frontend that agent is processing
            await _notify_agent_status(ctx.session_id, ctx.agent_id, "running")

            # Fetch effective MCP config for the user
            if ctx.user_id:
                try:
                    effective_mcp = await get_effective_mcp_config(db, ctx.user_id)
                    # Convert to dict format expected by agent service
                    if effective_mcp is not None:
                        servers_config = []
                        for server in effective_mcp.servers:
                            server_dict = {
                                "id": server.id,
                                "name": server.name,
                                "transport": server.transport,
                                "command": server.command,
                                "args": server.args,
                                "url": server.url,
                                "env_vars": server.env_vars,
                            }
                            # Transform workspace-based MCP servers to use HTTP
                            # These servers run in the workspace container's MCP gateway
                            if ctx.workspace_id and server.source_slug in (
                                "filesystem",
                                "git",
                            ):
                                workspace_container = f"podex-workspace-{ctx.workspace_id}"
                                server_dict["transport"] = "http"
                                server_dict["url"] = (
                                    f"http://{workspace_container}:3100/mcp/{server.source_slug}"
                                )
                                # Clear stdio-specific fields
                                server_dict["command"] = None
                                server_dict["args"] = []
                                logger.debug(
                                    "Transformed MCP server to workspace HTTP",
                                    server=server.name,
                                    url=server_dict["url"],
                                )
                            servers_config.append(server_dict)
                        ctx.mcp_config = {"servers": servers_config}
                        logger.debug(
                            "Loaded MCP config for agent",
                            user_id=ctx.user_id,
                            server_count=len(effective_mcp.servers),
                        )
                except Exception as e:
                    logger.warning(
                        "Failed to load MCP config, proceeding without MCP",
                        user_id=ctx.user_id,
                        error=str(e),
                    )
                    # Continue without MCP - agents can still function

            # Generate a message_id for streaming - tokens will be published to Redis
            # and the frontend will receive them in real-time via WebSocket
            stream_message_id = str(uuid4())

            # Notify frontend that streaming is starting
            await emit_agent_stream_start(ctx.session_id, ctx.agent_id, stream_message_id)

            # Build context for agent service and call agent
            agent_context = _build_agent_service_context(ctx, message_id=stream_message_id)
            tool_calls: list[dict[str, Any]] | None = None
            tokens_used: int = 0
            try:
                # Use execute_streaming to get both response and tool calls
                response_content, tool_calls, tokens_used = await agent_client.execute_streaming(
                    session_id=ctx.session_id,
                    agent_id=ctx.agent_id,
                    message=ctx.user_message,
                    context=agent_context,
                )
            except AgentClientError as e:
                logger.warning(
                    "Agent service call failed, using fallback",
                    agent_id=ctx.agent_id,
                    error=str(e),
                )
                # Fall back to simulated response in development
                if settings.ENVIRONMENT == "production":
                    raise
                response_content = _generate_agent_response(ctx.agent_role, ctx.user_message)
                tool_calls = None

            # Process and emit the response with tool calls
            # Set streamed=True since we use streaming - frontend already has message via Redis
            # Pass stream_message_id so DB message has same ID sent to frontend
            # Include tokens_used for consolidated commit (message + status + tokens)
            processing_ctx = ResponseProcessingContext(
                db=db,
                ctx=ctx,
                agent=agent,
                response_content=response_content,
                auto_play=auto_play,
                tool_calls=tool_calls,
                streamed=True,  # Streaming is always enabled now
                message_id=stream_message_id,  # Use the same ID that was sent to frontend
                tokens_used=tokens_used,  # Token count for consolidated DB update
            )
            await _process_and_emit_response(processing_ctx)

        except Exception as e:
            # Log the error with full context
            logger.exception(
                "Agent message processing failed",
                agent_id=ctx.agent_id,
                session_id=ctx.session_id,
                error=str(e),
            )
            # On error, set agent status to error
            try:
                await db.rollback()
                agent_query = select(AgentModel).where(AgentModel.id == ctx.agent_id)
                result = await db.execute(agent_query)
                agent = result.scalar_one_or_none()
                if agent:
                    agent.status = "error"
                    await db.commit()

                await _notify_agent_status(
                    ctx.session_id,
                    ctx.agent_id,
                    "error",
                    "Agent processing failed. Please try again.",
                )

                # Emit error attention notification
                error_attention = AgentAttentionInfo(
                    session_id=ctx.session_id,
                    agent_id=ctx.agent_id,
                    agent_name=ctx.agent_name,
                    attention_type="error",
                    title=get_attention_title("error", ctx.agent_name, ctx.agent_role),
                    message="Agent processing failed. Please try again.",
                    priority="high",
                    metadata={
                        "error": sanitize_error_for_client(e),  # Sanitized error message
                    },
                )
                await emit_agent_attention(error_attention)
            except Exception as inner_e:
                logger.exception(
                    "Failed to update agent error status",
                    agent_id=ctx.agent_id,
                    error=str(inner_e),
                )


@router.post("", response_model=AgentResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_agent(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: AgentCreate,
    db: DbSession,
) -> AgentResponse:
    """Create a new agent in session."""
    # Verify session exists and user has access
    session = await verify_session_access(session_id, request, db)

    # Validate command_allowlist for security
    try:
        validated_allowlist = validate_command_allowlist(data.command_allowlist)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Check agent quota before creating
    await check_agent_quota(db, session.owner_id, session_id)

    # If template_id provided, verify it exists (usage count incremented AFTER successful creation)
    template = None
    if data.template_id:
        template_query = select(AgentTemplate).where(AgentTemplate.id == data.template_id)
        template_result = await db.execute(template_query)
        template = template_result.scalar_one_or_none()

        if not template:
            raise HTTPException(status_code=404, detail="Agent template not found")

    # Count existing agents for color assignment - use COUNT() for efficiency
    count_query = (
        select(func.count()).select_from(AgentModel).where(AgentModel.session_id == session_id)
    )
    count_result = await db.execute(count_query)
    agent_count = count_result.scalar() or 0

    color = AGENT_COLORS[agent_count % len(AGENT_COLORS)]

    # Merge color into config
    config = data.config or {}
    config["color"] = color

    # If using a template, store template info in config for the agent service
    if template:
        config["template_config"] = {
            "name": template.name,
            "system_prompt": template.system_prompt,
            "allowed_tools": template.allowed_tools,
            "model": template.model,
            "temperature": template.temperature,
            "max_tokens": template.max_tokens,
        }

    # Determine role (custom if using template, otherwise as specified)
    role = "custom" if data.template_id else data.role

    # Determine model: template model > provided model > user default > role default from platform
    if template:
        model = template.model
    elif data.model:
        model = data.model
    else:
        # Prefer user's per-role default if accessible; otherwise fall back to platform default
        user_default_model = await _get_user_model_default_for_role(db, session.owner_id, role)
        if user_default_model:
            model = user_default_model
        else:
            model = await get_default_model_for_role(db, role)

    # Create agent
    agent = AgentModel(
        session_id=session_id,
        name=data.name,
        role=role,
        model=model,
        status="idle",
        mode=data.mode,
        command_allowlist=validated_allowlist,
        config=config,
        template_id=data.template_id,
    )
    db.add(agent)

    # Increment template usage count atomically with agent creation
    # Both operations are in the same transaction - either both succeed or both fail
    if data.template_id:
        await db.execute(
            update(AgentTemplate)
            .where(AgentTemplate.id == data.template_id)
            .values(usage_count=AgentTemplate.usage_count + 1),
        )

    # Single commit for both agent creation and template usage increment
    await db.commit()
    await db.refresh(agent)

    # Audit log: agent created
    user_id = get_current_user_id(request)
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_agent_event(
        AuditAction.AGENT_CREATED,
        agent_id=agent.id,
        session_id=session_id,
        details={"name": agent.name, "role": agent.role, "model": agent.model, "mode": agent.mode},
    )

    # Look up model display name
    model_display_name = await get_model_display_name(db, agent.model)

    return _build_agent_response(agent, model_display_name)


# ==================== Role Configuration Endpoint ====================
# NOTE: The primary public endpoint for role configs is now /api/agent-roles
# This endpoint is kept for backward compatibility but reads from the database.


class AgentRoleConfigResponse(BaseModel):
    """Response for a single agent role configuration."""

    name: str
    role: str
    color: str
    system_prompt: str
    tools: list[str]


class AgentRoleConfigsResponse(BaseModel):
    """Response containing all agent role configurations."""

    roles: dict[str, AgentRoleConfigResponse]


@router.get("/role-configs", response_model=AgentRoleConfigsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_role_configs(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> AgentRoleConfigsResponse:
    """Get default configurations for all agent roles.

    DEPRECATED: Use /api/agent-roles instead for more complete data.

    Returns the complete configuration for each role including:
    - Display name
    - Color for UI
    - Default system prompt
    - Default tools
    """
    from src.database.models import AgentRoleConfig

    result = await db.execute(
        select(AgentRoleConfig)
        .where(AgentRoleConfig.is_enabled == True)
        .order_by(AgentRoleConfig.sort_order)
    )
    configs = result.scalars().all()

    return AgentRoleConfigsResponse(
        roles={
            config.role: AgentRoleConfigResponse(
                name=config.name,
                role=config.role,
                color=config.color,
                system_prompt=config.system_prompt,
                tools=config.tools,
            )
            for config in configs
        }
    )


# ==================== Agent CRUD Endpoints ====================


@router.get("", response_model=list[AgentResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_agents(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> list[AgentResponse]:
    """List all agents in session."""
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Eagerly load conversation_session relationship to get conversation_session_id
    query = (
        select(AgentModel)
        .options(selectinload(AgentModel.attached_conversation))
        .where(AgentModel.session_id == session_id)
        .order_by(AgentModel.created_at)
    )
    result = await db.execute(query)
    agents = result.scalars().all()

    # Batch fetch all model display names
    model_ids = list({a.model for a in agents})
    model_result = await db.execute(
        select(LLMModel.model_id, LLMModel.display_name).where(LLMModel.model_id.in_(model_ids))
    )
    display_names = {row[0]: row[1] for row in model_result.all()}

    return [_build_agent_response(a, display_names.get(a.model)) for a in agents]


@router.get("/{agent_id}", response_model=AgentResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_agent(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> AgentResponse:
    """Get agent by ID."""
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Eagerly load conversation_session relationship to get conversation_session_id
    query = (
        select(AgentModel)
        .options(selectinload(AgentModel.attached_conversation))
        .where(
            AgentModel.id == agent_id,
            AgentModel.session_id == session_id,
        )
    )
    result = await db.execute(query)
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    model_display_name = await get_model_display_name(db, agent.model)
    return _build_agent_response(agent, model_display_name)


@router.patch("/{agent_id}/mode", response_model=AgentResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_agent_mode(
    session_id: str,
    agent_id: str,
    data: AgentModeUpdate,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> AgentResponse:
    """Update agent mode and permissions.

    Args:
        session_id: The session ID.
        agent_id: The agent ID.
        data: The mode update data.
    """
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Get the agent (eager-load conversation_session for _build_agent_response)
    query = (
        select(AgentModel)
        .where(
            AgentModel.id == agent_id,
            AgentModel.session_id == session_id,
        )
        .options(selectinload(AgentModel.attached_conversation))
    )
    result = await db.execute(query)
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Update mode and allowlist
    agent.mode = data.mode
    if data.command_allowlist is not None:
        agent.command_allowlist = data.command_allowlist

    await db.commit()
    await db.refresh(agent)

    # Emit mode update via WebSocket
    await emit_to_session(
        session_id,
        "agent_mode_update",
        {
            "agent_id": agent_id,
            "session_id": session_id,
            "mode": agent.mode,
            "command_allowlist": agent.command_allowlist,
        },
    )

    # Audit log: agent mode changed
    user_id = get_current_user_id(request)
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_agent_event(
        AuditAction.AGENT_MODE_CHANGED,
        agent_id=agent_id,
        session_id=session_id,
        details={"mode": agent.mode, "name": agent.name},
    )

    logger.info(
        "Agent mode updated",
        agent_id=agent_id,
        session_id=session_id,
        mode=agent.mode,
    )

    model_display_name = await get_model_display_name(db, agent.model)
    return _build_agent_response(agent, model_display_name)


@router.patch("/{agent_id}", response_model=AgentResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_agent(
    session_id: str,
    agent_id: str,
    data: AgentUpdate,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> AgentResponse:
    """Update agent settings (name, model).

    Args:
        session_id: The session ID.
        agent_id: The agent ID.
        data: The update data.
    """
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Get the agent (eager-load conversation_session for _build_agent_response)
    query = (
        select(AgentModel)
        .where(
            AgentModel.id == agent_id,
            AgentModel.session_id == session_id,
        )
        .options(selectinload(AgentModel.attached_conversation))
    )
    result = await db.execute(query)
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Track original model to detect changes
    original_model = agent.model

    # Update fields if provided
    if data.name is not None:
        agent.name = data.name
    if data.model is not None:
        agent.model = data.model

    # If the model changed, persist this as the user's per-role default model
    if data.model is not None and data.model != original_model:
        user_id = get_current_user_id(request)

        # Load or create UserConfig with minimal initialization
        config_result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
        config = config_result.scalar_one_or_none()

        if not config:
            config = UserConfig(
                user_id=user_id,
            )
            db.add(config)
            await db.flush()

        # Ensure agent_preferences and model_defaults exist as dictionaries
        if config.agent_preferences is None:
            config.agent_preferences = {}
        if not isinstance(config.agent_preferences, dict):
            config.agent_preferences = {}

        prefs: dict[str, Any] = dict(config.agent_preferences)
        model_defaults = prefs.get("model_defaults") or {}
        if not isinstance(model_defaults, dict):
            model_defaults = {}

        model_defaults[agent.role] = agent.model
        prefs["model_defaults"] = model_defaults
        config.agent_preferences = prefs

        # Invalidate cached user config so preferences are reflected immediately
        await cache_delete(user_config_key(user_id))

    await db.commit()
    await db.refresh(agent)

    # Emit update via WebSocket
    await emit_to_session(
        session_id,
        "agent_update",
        {
            "agent_id": agent_id,
            "session_id": session_id,
            "name": agent.name,
            "model": agent.model,
        },
    )

    logger.info(
        "Agent updated",
        agent_id=agent_id,
        session_id=session_id,
        name=agent.name,
        model=agent.model,
    )

    model_display_name = await get_model_display_name(db, agent.model)
    return _build_agent_response(agent, model_display_name)


class PlanModeToggleResponse(BaseModel):
    """Response from toggling plan mode."""

    mode: str
    previous_mode: str | None
    toggled_to_plan: bool


@router.post("/{agent_id}/toggle-plan-mode", response_model=PlanModeToggleResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def toggle_plan_mode(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> PlanModeToggleResponse:
    """Toggle between plan mode and the previous mode.

    If the agent is currently in plan mode, it restores the previous mode.
    If the agent is in any other mode, it switches to plan mode and stores
    the current mode as the previous mode.

    Args:
        session_id: The session ID.
        agent_id: The agent ID.

    Returns:
        The new mode and previous mode information.
    """
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Get the agent
    query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
    )
    result = await db.execute(query)
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    toggled_to_plan = False

    if agent.mode == "plan":
        # Currently in plan mode, restore previous mode
        new_mode = agent.previous_mode or "ask"  # Default to ask if no previous
        agent.mode = new_mode
        agent.previous_mode = "plan"  # Store plan as previous for potential toggle back
    else:
        # Not in plan mode, switch to plan
        agent.previous_mode = agent.mode
        agent.mode = "plan"
        new_mode = "plan"
        toggled_to_plan = True

    await db.commit()
    await db.refresh(agent)

    # Emit mode update via WebSocket
    await emit_to_session(
        session_id,
        "agent_mode_update",
        {
            "agent_id": agent_id,
            "session_id": session_id,
            "mode": agent.mode,
            "previous_mode": agent.previous_mode,
            "toggled_to_plan": toggled_to_plan,
        },
    )

    logger.info(
        "Agent plan mode toggled",
        agent_id=agent_id,
        session_id=session_id,
        mode=agent.mode,
        previous_mode=agent.previous_mode,
        toggled_to_plan=toggled_to_plan,
    )

    return PlanModeToggleResponse(
        mode=agent.mode,
        previous_mode=agent.previous_mode,
        toggled_to_plan=toggled_to_plan,
    )


@router.delete("/{agent_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_agent(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Delete an agent."""
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Load agent with its attached conversation session (if any)
    query = (
        select(AgentModel)
        .options(selectinload(AgentModel.attached_conversation))
        .where(
            AgentModel.id == agent_id,
            AgentModel.session_id == session_id,
        )
    )
    result = await db.execute(query)
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # The junction table has CASCADE delete, so deleting the agent will automatically
    # remove it from any attached conversations. The conversation itself is preserved.
    conversation_id = agent.attached_conversation.id if agent.attached_conversation else None

    # Capture agent info before deletion for audit log
    agent_name = agent.name
    agent_role = agent.role

    await db.delete(agent)
    await db.commit()

    # Audit log: agent deleted
    user_id = get_current_user_id(request)
    audit = AuditLogger(db).set_context(request=request, user_id=user_id)
    await audit.log_agent_event(
        AuditAction.AGENT_DELETED,
        agent_id=agent_id,
        session_id=session_id,
        details={"name": agent_name, "role": agent_role},
    )

    # If there was an attached conversation, emit a detach event so frontends
    # update their local state and keep the conversation in the pool.
    if conversation_id:
        await emit_to_session(
            session_id,
            "conversation_detached",
            {
                "conversation_id": conversation_id,
                "previous_agent_id": agent_id,
            },
        )

    return {"message": "Agent deleted"}


async def _send_message_impl(
    params: SendMessageParams,
    deps: SendMessageDeps,
) -> MessageResponse:
    """Implementation of send_message endpoint."""
    # Verify user has access to session
    session = await verify_session_access(params.session_id, deps.common.request, deps.common.db)

    # Update workspace activity to prevent idle standby
    await update_workspace_activity(session, deps.common.db)

    # Validate agent exists
    from sqlalchemy.orm import selectinload

    agent_query = (
        select(AgentModel)
        .options(selectinload(AgentModel.attached_conversation))
        .where(
            AgentModel.id == params.agent_id,
            AgentModel.session_id == params.session_id,
        )
    )
    agent_result = await deps.common.db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get user ID for credit check and agent context
    user_id = get_current_user_id(deps.common.request)

    # Check token credits before processing message
    from src.services.credit_enforcement import (
        check_credits_available,
        create_billing_error_detail,
    )

    credit_check = await check_credits_available(deps.common.db, user_id, "tokens")

    if not credit_check.can_proceed:
        raise HTTPException(
            status_code=402,  # Payment Required
            detail=create_billing_error_detail(
                credit_check,
                "tokens",
                "Token quota exceeded. Please upgrade your plan or add credits to continue.",
            ),
        )

    # Get or create conversation session for this agent
    conversation_session_id = None
    if agent.attached_conversation:
        conversation_session_id = agent.attached_conversation.id
    else:
        # Create a new conversation session and attach it to this agent
        from src.routes.conversations import derive_session_name

        conversation = ConversationSession(
            session_id=params.session_id,
            name=derive_session_name(params.data.content),
        )
        deps.common.db.add(conversation)
        await deps.common.db.flush()
        # Attach conversation to agent via the junction table
        conversation.attached_agents.append(agent)
        conversation_session_id = conversation.id

    # Deduplication: Check if an identical message was recently added to this conversation
    # This prevents duplicates from double-clicks, race conditions, or retries
    from datetime import timedelta

    recent_duplicate_check = await deps.common.db.execute(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_session_id == conversation_session_id,
            ConversationMessage.role == "user",
            ConversationMessage.content == params.data.content,
            ConversationMessage.created_at >= func.now() - timedelta(seconds=5),
        )
        .order_by(ConversationMessage.created_at.desc())
        .limit(1)
    )
    existing_message = recent_duplicate_check.scalar_one_or_none()

    if existing_message:
        # Message already exists - return the existing one instead of creating duplicate
        logger.info(
            "Duplicate message prevented",
            conversation_session_id=conversation_session_id,
            message_id=existing_message.id,
            content_preview=params.data.content[:50],
        )
        await deps.common.db.refresh(existing_message)
        return MessageResponse(
            id=existing_message.id,
            agent_id=params.agent_id,
            role=existing_message.role,
            content=existing_message.content,
            tool_calls=existing_message.tool_calls,
            images=None,
            created_at=existing_message.created_at,
        )

    # Create user message in the conversation session
    message = ConversationMessage(
        conversation_session_id=conversation_session_id,
        role="user",
        content=params.data.content,
    )
    deps.common.db.add(message)

    # Update conversation metadata
    conv_result = await deps.common.db.execute(
        select(ConversationSession).where(ConversationSession.id == conversation_session_id)
    )
    conversation = cast("ConversationSession", conv_result.scalar_one_or_none())
    conversation.message_count += 1
    conversation.last_message_at = func.now()
    # Update name from first message if it was "New Session"
    if conversation.message_count == 1 and conversation.name == "New Session":
        from src.routes.conversations import derive_session_name

        conversation.name = derive_session_name(params.data.content)

    await deps.common.db.commit()
    await deps.common.db.refresh(message)

    # Broadcast user message to all session participants via WebSocket
    await emit_to_session(
        params.session_id,
        "agent_message",
        {
            "id": message.id,
            "agent_id": params.agent_id,
            "agent_name": agent.name,
            "role": "user",
            "content": params.data.content,
            "session_id": params.session_id,
            "created_at": message.created_at.isoformat(),
        },
    )

    # Process image attachments if provided
    images_data: list[dict[str, Any]] | None = None
    if params.data.images:
        images_data = [
            {
                "type": img.type,
                "url": img.url,
                "base64_data": img.base64_data,
                "content_type": img.content_type,
                "filename": img.filename,
            }
            for img in params.data.images
        ]

    # Process thinking config if provided
    thinking_config_data: dict[str, Any] | None = None
    if params.data.thinking_config and params.data.thinking_config.enabled:
        thinking_config_data = {
            "enabled": params.data.thinking_config.enabled,
            "budget_tokens": params.data.thinking_config.budget_tokens,
        }

    # Load user's LLM API keys (from both static config and OAuth tokens)
    llm_api_keys: dict[str, str] | None = None
    if user_id:
        # First, get static API keys from user config
        user_config_result = await deps.common.db.execute(
            select(UserConfig).where(UserConfig.user_id == user_id)
        )
        user_config = user_config_result.scalar_one_or_none()
        if user_config and user_config.llm_api_keys:
            llm_api_keys = dict(user_config.llm_api_keys)

        # Then, get OAuth tokens and merge them (OAuth tokens take precedence)
        import time

        oauth_tokens_result = await deps.common.db.execute(
            select(UserOAuthToken).where(
                UserOAuthToken.user_id == user_id,
                UserOAuthToken.status == "connected",
            )
        )
        oauth_tokens = oauth_tokens_result.scalars().all()

        current_time = int(time.time())
        for token in oauth_tokens:
            # Skip expired tokens
            if token.expires_at and token.expires_at <= current_time:
                logger.debug(
                    "Skipping expired OAuth token",
                    provider=token.provider,
                    expires_at=token.expires_at,
                    current_time=current_time,
                )
                continue
            # Map provider to API key format
            if llm_api_keys is None:
                llm_api_keys = {}
            llm_api_keys[token.provider] = token.access_token
            logger.info(
                "Loaded OAuth token for provider",
                provider=token.provider,
                token_prefix=token.access_token[:15] + "..." if token.access_token else None,
            )
    else:
        logger.debug("No user_id available, skipping OAuth token loading")

    # Resolve model provider: check for local provider prefix first, then database
    model_provider: str | None = None
    agent_model_for_llm = agent.model  # Model ID to pass to LLM (may strip prefix)

    # Check if model ID has a local provider prefix (e.g., "ollama/qwen2.5-coder:14b")
    if "/" in agent.model:
        prefix, local_model_id = agent.model.split("/", 1)
        if prefix in {"ollama", "lmstudio"}:
            model_provider = prefix
            agent_model_for_llm = local_model_id  # Use just the model name for LLM
            logger.info(
                "Using local provider from model ID prefix",
                model=agent.model,
                provider=model_provider,
                local_model_id=local_model_id,
            )

    # If not a local model, look up provider from database
    if not model_provider:
        model_result = await deps.common.db.execute(
            select(LLMModel.provider).where(LLMModel.model_id == agent.model)
        )
        model_row = model_result.scalar_one_or_none()
        if model_row:
            model_provider = model_row
            logger.info(
                "Resolved model provider from database",
                model=agent.model,
                provider=model_provider,
                available_llm_keys=list(llm_api_keys.keys()) if llm_api_keys else [],
            )

    # Schedule background task to process the message and generate agent response
    msg_context = AgentMessageContext(
        session_id=params.session_id,
        agent_id=params.agent_id,
        agent_name=agent.name,
        agent_role=agent.role,
        agent_model=agent_model_for_llm,  # Use stripped model name for LLM
        user_message=params.data.content,
        conversation_session_id=conversation_session_id,
        agent_config=agent.config,
        user_id=user_id,
        agent_mode=agent.mode,
        command_allowlist=agent.command_allowlist,
        images=images_data,
        thinking_config=thinking_config_data,
        llm_api_keys=llm_api_keys,
        workspace_id=str(session.workspace_id) if session.workspace_id else None,
        claude_session_id=params.data.claude_session_id,
        model_provider=model_provider,
    )
    deps.background_tasks.add_task(process_agent_message, msg_context)

    return MessageResponse(
        id=message.id,
        agent_id=params.agent_id,  # Use params since ConversationMessage doesn't have agent_id
        role=message.role,
        content=message.content,
        tool_calls=message.tool_calls,
        images=images_data,
        created_at=message.created_at,
    )


@router.post("/{agent_id}/messages", response_model=MessageResponse)
@limiter.limit(RATE_LIMIT_AGENT)
async def send_message(
    session_id: str,
    agent_id: str,
    data: MessageCreate,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    background_tasks: BackgroundTasks,
) -> MessageResponse:
    """Send message to agent."""
    common = CommonDeps(request=request, db=db)
    params = SendMessageParams(session_id=session_id, agent_id=agent_id, data=data)
    deps = SendMessageDeps(common=common, background_tasks=background_tasks)
    return await _send_message_impl(params, deps)


async def _get_messages_impl(
    params: GetMessagesParams,
    common: CommonDeps,
) -> list[MessageResponse]:
    """Implementation of get_messages endpoint.

    Supports both cursor-based and offset-based pagination:
    - Cursor-based (preferred): Provide `cursor` (message ID) to get messages after that message.
      This is O(log n) using index on created_at and efficient for large datasets.
    - Offset-based (legacy): Uses OFFSET which is O(n) for large offsets. Avoid for deep pagination.
    """
    # Verify user has access to session
    await verify_session_access(params.session_id, common.request, common.db)

    # Verify agent exists and get its conversation session
    from sqlalchemy.orm import selectinload

    agent_query = (
        select(AgentModel)
        .options(selectinload(AgentModel.attached_conversation))
        .where(
            AgentModel.id == params.agent_id,
            AgentModel.session_id == params.session_id,
        )
    )
    agent_result = await common.db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # If agent has no conversation session, return empty list
    if not agent.attached_conversation:
        return []

    conversation_session_id = agent.attached_conversation.id

    # Build base query - messages now come from ConversationMessage
    query = select(ConversationMessage).where(
        ConversationMessage.conversation_session_id == conversation_session_id
    )

    # Use cursor-based pagination if cursor provided (more efficient)
    if params.pagination.cursor:
        # First, get the cursor message to find its created_at timestamp
        cursor_query = select(ConversationMessage.created_at, ConversationMessage.id).where(
            ConversationMessage.id == params.pagination.cursor,
            ConversationMessage.conversation_session_id == conversation_session_id,
        )
        cursor_result = await common.db.execute(cursor_query)
        cursor_row = cursor_result.first()

        if cursor_row:
            cursor_created_at, cursor_id = cursor_row
            # Get messages after the cursor (using composite key for deterministic ordering)
            query = query.where(
                (ConversationMessage.created_at > cursor_created_at)
                | (
                    (ConversationMessage.created_at == cursor_created_at)
                    & (ConversationMessage.id > cursor_id)
                )
            )
        # If cursor message not found, ignore and return from start

    # Apply ordering and limit
    query = query.order_by(ConversationMessage.created_at, ConversationMessage.id).limit(
        params.pagination.limit
    )

    # Only apply offset if not using cursor (for backwards compatibility)
    if not params.pagination.cursor:
        query = query.offset(params.pagination.offset)

    result = await common.db.execute(query)
    messages = result.scalars().all()

    return [
        MessageResponse(
            id=m.id,
            agent_id=params.agent_id,  # Use params since ConversationMessage doesn't have agent_id
            role=m.role,
            content=m.content,
            tool_calls=m.tool_calls,
            created_at=m.created_at,
        )
        for m in messages
    ]


@router.get("/{agent_id}/messages", response_model=list[MessageResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_messages(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    limit: int = 100,
    offset: int = 0,
    cursor: str | None = None,
) -> list[MessageResponse]:
    """Get agent conversation history with pagination.

    Supports two pagination methods:
    - Cursor-based (recommended): Pass `cursor` (message ID) to get messages after that message.
      This is efficient for large datasets as it uses indexed lookups.
    - Offset-based (legacy): Pass `offset` to skip N messages. Avoid for deep pagination
      as it becomes slower with larger offsets.

    Args:
        limit: Maximum number of messages to return (default 100, max 500).
        offset: Number of messages to skip (for offset-based pagination).
        cursor: Message ID to start after (for cursor-based pagination).
            When provided, offset is ignored.
    """
    common = CommonDeps(request=request, db=db)
    params = GetMessagesParams(
        session_id=session_id,
        agent_id=agent_id,
        pagination=PaginationParams(limit=limit, offset=offset, cursor=cursor),
    )
    return await _get_messages_impl(params, common)


@router.post("/{agent_id}/abort")
@limiter.limit(RATE_LIMIT_STANDARD)
async def abort_agent(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str | int | bool]:
    """Abort running tasks for an agent.

    This stops any currently processing task and sets the agent to idle state.
    Used when user presses Escape to cancel an ongoing operation.
    """
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Verify agent exists in session (with conversation session for message creation)
    from sqlalchemy.orm import selectinload

    agent_query = (
        select(AgentModel)
        .options(selectinload(AgentModel.attached_conversation))
        .where(
            AgentModel.id == agent_id,
            AgentModel.session_id == session_id,
        )
    )
    agent_result = await db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Call agent service to abort tasks
    cancelled_count = 0
    try:
        result = await agent_client.abort_agent(agent_id)
        cancelled_count = result.get("cancelled_count", 0)
    except Exception as e:
        logger.warning(
            "Failed to abort agent tasks in agent service",
            agent_id=agent_id,
            error=str(e),
        )

    # Update agent status to idle
    agent.status = "idle"
    await db.commit()

    # Notify via WebSocket
    await _notify_agent_status(session_id, agent_id, "idle")

    # Add an "Aborted" message if there were tasks cancelled
    if cancelled_count > 0 and agent.attached_conversation:
        aborted_message = ConversationMessage(
            conversation_session_id=agent.attached_conversation.id,
            role="assistant",
            content="Task aborted by user.",
        )
        db.add(aborted_message)
        # Update conversation metadata
        agent.attached_conversation.message_count += 1
        agent.attached_conversation.last_message_at = func.now()
        await db.commit()
        await db.refresh(aborted_message)

        # Emit the aborted message
        await emit_to_session(
            session_id,
            "agent_message",
            {
                "id": aborted_message.id,
                "agent_id": agent_id,
                "agent_name": agent.name,
                "role": "assistant",
                "content": "Task aborted by user.",
                "session_id": session_id,
                "created_at": aborted_message.created_at.isoformat(),
            },
        )

    return {
        "success": True,
        "agent_id": agent_id,
        "cancelled_count": cancelled_count,
        "message": "Agent tasks aborted" if cancelled_count > 0 else "No running tasks to abort",
    }


@router.post("/{agent_id}/force-stop")
@limiter.limit(RATE_LIMIT_STANDARD)
async def force_stop_agent(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str | int | bool]:
    """Force-stop a stuck agent, resetting its state completely.

    Unlike abort, this performs a complete reset:
    - Cancels all pending tasks via agent service (best effort)
    - Resets agent status to idle
    - Clears any pending approvals for this agent
    - Updates status_changed_at timestamp
    - Notifies all connected clients

    Use when an agent is completely unresponsive or stuck in an error state.
    This is more aggressive than abort and should be used as a last resort.
    """
    from datetime import UTC, datetime

    from sqlalchemy import delete

    from src.database.models import AgentPendingApproval

    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Verify agent exists in session
    agent_query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
    )
    agent_result = await db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    previous_status = agent.status
    cancelled_count = 0

    # Try to cancel via agent service (best effort - don't fail if this doesn't work)
    try:
        result = await agent_client.abort_agent(agent_id)
        cancelled_count = result.get("cancelled_count", 0)
    except Exception as e:
        logger.warning(
            "Agent service abort failed during force-stop",
            agent_id=agent_id,
            error=str(e),
        )

    # Force reset status to idle (regardless of current state)
    agent.status = "idle"
    agent.status_changed_at = datetime.now(UTC)

    # Clear any pending approvals for this agent
    await db.execute(
        delete(AgentPendingApproval).where(
            AgentPendingApproval.agent_id == agent_id,
            AgentPendingApproval.status == "pending",
        )
    )

    await db.commit()

    # Notify clients of status change
    await _notify_agent_status(session_id, agent_id, "idle")

    # Emit force-stop event with details
    await emit_to_session(
        session_id,
        "agent_force_stopped",
        {
            "agent_id": agent_id,
            "previous_status": previous_status,
            "tasks_cancelled": cancelled_count,
        },
    )

    logger.info(
        "Agent force-stopped",
        agent_id=agent_id,
        session_id=session_id,
        previous_status=previous_status,
        tasks_cancelled=cancelled_count,
    )

    return {
        "success": True,
        "agent_id": agent_id,
        "previous_status": previous_status,
        "cancelled_count": cancelled_count,
        "message": "Agent force-stopped and reset to idle",
    }


# ==================== Agent Pause/Resume ====================


@router.post("/{agent_id}/pause")
@limiter.limit(RATE_LIMIT_STANDARD)
async def pause_agent(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str | bool]:
    """Pause a running agent.

    Unlike abort, pause allows the agent to be resumed later.
    The agent's current task state is preserved.
    """
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Verify agent exists in session (with conversation session for message creation)
    from sqlalchemy.orm import selectinload

    agent_query = (
        select(AgentModel)
        .options(selectinload(AgentModel.attached_conversation))
        .where(
            AgentModel.id == agent_id,
            AgentModel.session_id == session_id,
        )
    )
    agent_result = await db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if agent.status not in ("running", "thinking"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot pause agent in '{agent.status}' state. Agent must be running.",
        )

    # Call agent service to pause
    try:
        await agent_client.pause_agent(agent_id)
    except Exception as e:
        logger.warning(
            "Failed to pause agent in agent service",
            agent_id=agent_id,
            error=str(e),
        )
        # Continue anyway - we'll update the local status

    # Update agent status to paused
    agent.status = "paused"
    await db.commit()

    # Notify via WebSocket
    await _notify_agent_status(session_id, agent_id, "paused")

    # Emit system message (only if conversation session exists)
    if agent.attached_conversation:
        pause_message = ConversationMessage(
            conversation_session_id=agent.attached_conversation.id,
            role="system",
            content="Agent paused by user. Send a message to resume.",
        )
        db.add(pause_message)
        agent.attached_conversation.message_count += 1
        agent.attached_conversation.last_message_at = func.now()
        await db.commit()
        await db.refresh(pause_message)

        await emit_to_session(
            session_id,
            "agent_message",
            {
                "id": pause_message.id,
                "agent_id": agent_id,
                "agent_name": agent.name,
                "role": "system",
                "content": "Agent paused by user. Send a message to resume.",
                "session_id": session_id,
                "created_at": pause_message.created_at.isoformat(),
            },
        )

    return {
        "success": True,
        "agent_id": agent_id,
        "status": "paused",
        "message": "Agent paused. Send a message to resume.",
    }


@router.post("/{agent_id}/resume")
@limiter.limit(RATE_LIMIT_STANDARD)
async def resume_agent(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str | bool]:
    """Resume a paused agent.

    The agent will continue from where it was paused.
    """
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Verify agent exists in session (with conversation session for message creation)
    from sqlalchemy.orm import selectinload

    agent_query = (
        select(AgentModel)
        .options(selectinload(AgentModel.attached_conversation))
        .where(
            AgentModel.id == agent_id,
            AgentModel.session_id == session_id,
        )
    )
    agent_result = await db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if agent.status != "paused":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume agent in '{agent.status}' state. Agent must be paused.",
        )

    # Call agent service to resume
    try:
        await agent_client.resume_agent(agent_id)
    except Exception as e:
        logger.warning(
            "Failed to resume agent in agent service",
            agent_id=agent_id,
            error=str(e),
        )
        # Continue anyway - we'll update the local status

    # Update agent status to running
    agent.status = "running"
    await db.commit()

    # Notify via WebSocket
    await _notify_agent_status(session_id, agent_id, "running")

    # Emit system message (only if conversation session exists)
    if agent.attached_conversation:
        resume_message = ConversationMessage(
            conversation_session_id=agent.attached_conversation.id,
            role="system",
            content="Agent resumed. Continuing from where it left off.",
        )
        db.add(resume_message)
        agent.attached_conversation.message_count += 1
        agent.attached_conversation.last_message_at = func.now()
        await db.commit()
        await db.refresh(resume_message)

        await emit_to_session(
            session_id,
            "agent_message",
            {
                "id": resume_message.id,
                "agent_id": agent_id,
                "agent_name": agent.name,
                "role": "system",
                "content": "Agent resumed. Continuing from where it left off.",
                "session_id": session_id,
                "created_at": resume_message.created_at.isoformat(),
            },
        )

    return {
        "success": True,
        "agent_id": agent_id,
        "status": "running",
        "message": "Agent resumed",
    }


# ==================== Agent Duplicate ====================


class DuplicateAgentRequest(BaseModel):
    """Request body for duplicating an agent."""

    name: str | None = None  # Optional custom name for the duplicated agent


@router.post("/{agent_id}/duplicate", response_model=AgentResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def duplicate_agent(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    data: DuplicateAgentRequest | None = None,
) -> AgentResponse:
    """Duplicate an existing agent.

    Creates a new agent with the same configuration as the original.
    Messages are not copied - the new agent starts with a clean history.
    """
    # Verify user has access to session
    session = await verify_session_access(session_id, request, db)

    # Check agent quota before creating
    await check_agent_quota(db, session.owner_id, session_id)

    # Get the original agent
    agent_query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
    )
    agent_result = await db.execute(agent_query)
    original_agent = agent_result.scalar_one_or_none()

    if not original_agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Generate new name
    new_name = data.name if data and data.name else f"{original_agent.name} (Copy)"

    # Count existing agents for color assignment
    count_query = (
        select(func.count()).select_from(AgentModel).where(AgentModel.session_id == session_id)
    )
    count_result = await db.execute(count_query)
    agent_count = count_result.scalar() or 0
    color = AGENT_COLORS[agent_count % len(AGENT_COLORS)]

    # Copy config and update color
    new_config = dict(original_agent.config) if original_agent.config else {}
    new_config["color"] = color

    # Create the duplicate agent
    new_agent = AgentModel(
        session_id=session_id,
        name=new_name,
        role=original_agent.role,
        model=original_agent.model,
        status="idle",
        mode=original_agent.mode,
        command_allowlist=original_agent.command_allowlist,
        config=new_config,
        template_id=original_agent.template_id,
        voice_config=original_agent.voice_config,
    )
    db.add(new_agent)
    await db.commit()
    await db.refresh(new_agent)

    logger.info(
        "Agent duplicated",
        original_agent_id=agent_id,
        new_agent_id=new_agent.id,
        session_id=session_id,
    )

    model_display_name = await get_model_display_name(db, new_agent.model)
    return _build_agent_response(new_agent, model_display_name)


# ==================== Message Delete ====================


@router.delete("/{agent_id}/messages/{message_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_message(
    session_id: str,
    agent_id: str,
    message_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Delete a specific message from an agent's conversation history.

    This removes the message from both the database and the frontend display.
    """
    # Verify user has access to session
    await verify_session_access(session_id, request, db)

    # Verify agent exists in session and get its conversation session
    from sqlalchemy.orm import selectinload

    agent_query = (
        select(AgentModel)
        .options(selectinload(AgentModel.attached_conversation))
        .where(
            AgentModel.id == agent_id,
            AgentModel.session_id == session_id,
        )
    )
    agent_result = await db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not agent.attached_conversation:
        raise HTTPException(status_code=404, detail="Agent has no conversation session")

    # Get the message from the conversation session
    message_query = select(ConversationMessage).where(
        ConversationMessage.id == message_id,
        ConversationMessage.conversation_session_id == agent.attached_conversation.id,
    )
    message_result = await db.execute(message_query)
    message = message_result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Delete the message and update conversation metadata
    await db.delete(message)
    agent.attached_conversation.message_count = max(
        0, agent.attached_conversation.message_count - 1
    )
    await db.commit()

    # Notify via WebSocket
    await emit_to_session(
        session_id,
        "message_deleted",
        {
            "message_id": message_id,
            "agent_id": agent_id,
            "session_id": session_id,
        },
    )

    logger.info(
        "Message deleted",
        message_id=message_id,
        agent_id=agent_id,
        session_id=session_id,
    )

    return {"message": "Message deleted"}


# ==================== Native Agent Approval Requests ====================


class ApprovalRequestPayload(BaseModel):
    """Payload from agent service when an agent needs user approval."""

    approval_id: str
    agent_id: str
    session_id: str
    tool_name: str
    action_type: str  # file_write, command_execute, other
    arguments: dict[str, Any]
    can_add_to_allowlist: bool = False


@router.post("/approvals/request")
async def create_approval_request(
    payload: ApprovalRequestPayload,
    db: DbSession,
) -> dict[str, Any]:
    """Receive an approval request from the agent service.

    When a native Podex agent in Ask/Auto mode needs user approval for a
    restricted action (file write or command execution), it calls this
    endpoint. We store the pending approval in the database and emit a
    websocket event to notify the frontend.

    This endpoint is called by the agent service, not by users directly.
    """
    from datetime import UTC, timedelta

    from src.database.models import AgentPendingApproval

    # Verify the agent exists
    agent_query = select(AgentModel).where(AgentModel.id == payload.agent_id)
    agent_result = await db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    if not agent:
        logger.warning(
            "Approval request for unknown agent",
            agent_id=payload.agent_id,
            approval_id=payload.approval_id,
        )
        return {"success": False, "error": "Agent not found"}

    # Create the pending approval record
    expires_at = datetime.now(UTC) + timedelta(minutes=5)  # 5 minute timeout

    pending_approval = AgentPendingApproval(
        id=payload.approval_id,
        agent_id=payload.agent_id,
        session_id=payload.session_id,
        action_type=payload.action_type,
        action_details={
            "tool_name": payload.tool_name,
            "command": payload.arguments.get("command"),
            "file_path": payload.arguments.get("path") or payload.arguments.get("file_path"),
            "arguments": payload.arguments,
        },
        status="pending",
        expires_at=expires_at,
    )

    db.add(pending_approval)
    await db.commit()

    logger.info(
        "Created pending approval",
        approval_id=payload.approval_id,
        agent_id=payload.agent_id,
        tool_name=payload.tool_name,
        action_type=payload.action_type,
    )

    # Emit websocket event to notify frontend
    await emit_to_session(
        payload.session_id,
        "native_approval_request",
        {
            "approval_id": payload.approval_id,
            "agent_id": payload.agent_id,
            "agent_name": agent.name,
            "session_id": payload.session_id,
            "action_type": payload.action_type,
            "action_details": {
                "tool_name": payload.tool_name,
                "command": payload.arguments.get("command"),
                "file_path": payload.arguments.get("path") or payload.arguments.get("file_path"),
                "arguments": payload.arguments,
            },
            "can_add_to_allowlist": payload.can_add_to_allowlist,
            "expires_at": expires_at.isoformat(),
        },
    )

    # Also emit agent attention so the user notices
    await emit_agent_attention(
        AgentAttentionInfo(
            session_id=payload.session_id,
            agent_id=payload.agent_id,
            agent_name=agent.name,
            attention_type="needs_approval",
            title=f"{agent.name} needs your approval",
            message=(
                f"{payload.tool_name}: "
                f"{payload.arguments.get('command') or payload.arguments.get('path') or 'action'}"
            ),
            priority="high",
            metadata={
                "approval_request": True,
                "approval_id": payload.approval_id,
                "tool_name": payload.tool_name,
            },
        )
    )

    return {"success": True, "approval_id": payload.approval_id}
