"""Agent management routes."""

import re
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Annotated, Any
from uuid import uuid4

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from podex_shared import generate_tts_summary
from src.agent_client import agent_client
from src.config import settings
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
from src.database import Message as MessageModel
from src.database import Session as SessionModel
from src.database.connection import async_session_factory
from src.exceptions import (
    AgentClientError,
    EmptyMessageContentError,
    InvalidAgentRoleError,
    MessageContentTooLargeError,
)
from src.mcp_config import get_effective_mcp_config
from src.middleware.rate_limit import RATE_LIMIT_AGENT, RATE_LIMIT_STANDARD, limiter
from src.routes.dependencies import DbSession, get_current_user_id, verify_session_access
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
    created_at: datetime

    class Config:
        from_attributes = True


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


class MessageCreate(BaseModel):
    """Create message request."""

    content: str
    images: list[ImageAttachment] | None = None  # Optional image attachments
    thinking_config: ThinkingConfigRequest | None = None  # Extended thinking config

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

    class Config:
        from_attributes = True


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


# Default model for when platform settings don't have a role default configured
DEFAULT_FALLBACK_MODEL = "anthropic.claude-sonnet-4-5-20250929-v1:0"


async def get_default_model_for_role(db: AsyncSession, role: str) -> str:
    """Get the default model for an agent role from platform settings.

    Args:
        db: Database session
        role: The agent role (e.g., 'chat', 'coder', 'architect')

    Returns:
        The default model ID for the role, or a fallback if not configured
    """
    result = await db.execute(
        select(PlatformSetting).where(PlatformSetting.key == "agent_model_defaults")
    )
    setting = result.scalar_one_or_none()

    if setting and setting.value:
        defaults = setting.value
        if role in defaults and "model_id" in defaults[role]:
            return str(defaults[role]["model_id"])

    # Return fallback model if no default configured for this role
    return DEFAULT_FALLBACK_MODEL


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
        created_at=agent.created_at,
    )


# Agent role system prompts for context
AGENT_ROLE_PROMPTS: dict[str, str] = {
    "architect": (
        "You are an architect agent. Help design system architecture, "
        "plan implementations, and break down complex tasks into manageable steps."
    ),
    "coder": (
        "You are a coding agent. Write clean, efficient code and "
        "implement features based on specifications."
    ),
    "reviewer": (
        "You are a code review agent. Review code for bugs, "
        "security issues, best practices, and suggest improvements."
    ),
    "tester": (
        "You are a testing agent. Write tests, identify edge cases, "
        "and ensure code quality through testing."
    ),
    "security": (
        "You are a security agent. Identify security vulnerabilities, "
        "suggest secure coding practices, and help implement security measures."
    ),
    "devops": (
        "You are a DevOps agent. Help with CI/CD pipelines, infrastructure, "
        "deployment configurations, and operational best practices."
    ),
    "orchestrator": (
        "You are an orchestrator agent. Coordinate tasks between multiple agents, "
        "delegate work appropriately, and ensure efficient task completion."
    ),
    "agent_builder": (
        "You are an agent builder. Help create custom agent configurations, "
        "define system prompts, and configure agent capabilities."
    ),
    "documentator": (
        "You are a documentation agent. Write clear documentation, API references, "
        "README files, and help maintain project documentation."
    ),
    "chat": (
        "You are a conversational assistant. Answer questions, provide explanations, "
        "and help users understand the codebase and project."
    ),
    "custom": "You are a helpful AI assistant.",
}

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


def _build_agent_service_context(
    ctx: AgentMessageContext,
    message_id: str | None = None,
) -> dict[str, Any]:
    """Build context dictionary for agent service call."""
    agent_context: dict[str, Any] = {
        "role": ctx.agent_role,
        "model": ctx.agent_model,
    }
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
    message: MessageModel,
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
    assistant_message = MessageModel(
        id=processing_ctx.message_id,  # Will be None for non-streaming, triggering auto-generation
        agent_id=ctx.agent_id,
        role="assistant",
        content=response_content,
        tts_summary=tts_summary,
    )
    db.add(assistant_message)

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
                        ctx.mcp_config = {
                            "servers": [
                                {
                                    "id": server.id,
                                    "name": server.name,
                                    "transport": server.transport,
                                    "command": server.command,
                                    "args": server.args,
                                    "url": server.url,
                                    "env_vars": server.env_vars,
                                }
                                for server in effective_mcp.servers
                            ],
                        }
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

    # Determine model: template model > provided model > role default from platform settings
    if template:
        model = template.model
    elif data.model:
        model = data.model
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

    # Look up model display name
    model_display_name = await get_model_display_name(db, agent.model)

    return _build_agent_response(agent, model_display_name)


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

    query = (
        select(AgentModel)
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

    query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
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

    # Get the agent
    query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
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

    # Get the agent
    query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
    )
    result = await db.execute(query)
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Update fields if provided
    if data.name is not None:
        agent.name = data.name
    if data.model is not None:
        agent.model = data.model

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

    query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
    )
    result = await db.execute(query)
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    await db.delete(agent)
    await db.commit()
    return {"message": "Agent deleted"}


async def _send_message_impl(
    params: SendMessageParams,
    deps: SendMessageDeps,
) -> MessageResponse:
    """Implementation of send_message endpoint."""
    # Verify user has access to session
    await verify_session_access(params.session_id, deps.common.request, deps.common.db)

    # Validate agent exists
    agent_query = select(AgentModel).where(
        AgentModel.id == params.agent_id,
        AgentModel.session_id == params.session_id,
    )
    agent_result = await deps.common.db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Create user message
    message = MessageModel(
        agent_id=params.agent_id,
        role="user",
        content=params.data.content,
    )
    deps.common.db.add(message)
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

    # Get user ID for agent context
    user_id = get_current_user_id(deps.common.request)

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

    # Load user's LLM API keys if they exist
    llm_api_keys: dict[str, str] | None = None
    if user_id:
        user_config_result = await deps.common.db.execute(
            select(UserConfig).where(UserConfig.user_id == user_id)
        )
        user_config = user_config_result.scalar_one_or_none()
        if user_config and user_config.llm_api_keys:
            llm_api_keys = user_config.llm_api_keys

    # Schedule background task to process the message and generate agent response
    msg_context = AgentMessageContext(
        session_id=params.session_id,
        agent_id=params.agent_id,
        agent_name=agent.name,
        agent_role=agent.role,
        agent_model=agent.model,
        user_message=params.data.content,
        agent_config=agent.config,
        user_id=user_id,
        agent_mode=agent.mode,
        command_allowlist=agent.command_allowlist,
        images=images_data,
        thinking_config=thinking_config_data,
        llm_api_keys=llm_api_keys,
    )
    deps.background_tasks.add_task(process_agent_message, msg_context)

    return MessageResponse(
        id=message.id,
        agent_id=message.agent_id,
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

    # Verify agent exists in session
    agent_query = select(AgentModel).where(
        AgentModel.id == params.agent_id,
        AgentModel.session_id == params.session_id,
    )
    agent_result = await common.db.execute(agent_query)
    if not agent_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Agent not found")

    # Build base query
    query = select(MessageModel).where(MessageModel.agent_id == params.agent_id)

    # Use cursor-based pagination if cursor provided (more efficient)
    if params.pagination.cursor:
        # First, get the cursor message to find its created_at timestamp
        cursor_query = select(MessageModel.created_at, MessageModel.id).where(
            MessageModel.id == params.pagination.cursor,
            MessageModel.agent_id == params.agent_id,
        )
        cursor_result = await common.db.execute(cursor_query)
        cursor_row = cursor_result.first()

        if cursor_row:
            cursor_created_at, cursor_id = cursor_row
            # Get messages after the cursor (using composite key for deterministic ordering)
            # This is efficient as it uses the index on created_at
            query = query.where(
                (MessageModel.created_at > cursor_created_at)
                | ((MessageModel.created_at == cursor_created_at) & (MessageModel.id > cursor_id))
            )
        # If cursor message not found, ignore and return from start

    # Apply ordering and limit
    query = query.order_by(MessageModel.created_at, MessageModel.id).limit(params.pagination.limit)

    # Only apply offset if not using cursor (for backwards compatibility)
    if not params.pagination.cursor:
        query = query.offset(params.pagination.offset)

    result = await common.db.execute(query)
    messages = result.scalars().all()

    return [
        MessageResponse(
            id=m.id,
            agent_id=m.agent_id,
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

    # Verify agent exists in session
    agent_query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
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
    if cancelled_count > 0:
        aborted_message = MessageModel(
            agent_id=agent_id,
            role="assistant",
            content="Task aborted by user.",
        )
        db.add(aborted_message)
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

    # Verify agent exists in session
    agent_query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
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

    # Emit system message
    pause_message = MessageModel(
        agent_id=agent_id,
        role="system",
        content="Agent paused by user. Send a message to resume.",
    )
    db.add(pause_message)
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

    # Verify agent exists in session
    agent_query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
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

    # Emit system message
    resume_message = MessageModel(
        agent_id=agent_id,
        role="system",
        content="Agent resumed. Continuing from where it left off.",
    )
    db.add(resume_message)
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

    # Verify agent exists in session
    agent_query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
    )
    agent_result = await db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get the message
    message_query = select(MessageModel).where(
        MessageModel.id == message_id,
        MessageModel.agent_id == agent_id,
    )
    message_result = await db.execute(message_query)
    message = message_result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Delete the message
    await db.delete(message)
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
