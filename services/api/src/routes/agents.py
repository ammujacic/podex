"""Agent management routes."""

import re
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from podex_shared import generate_tts_summary
from src.agent_client import agent_client
from src.config import settings
from src.database import Agent as AgentModel
from src.database import AgentTemplate, SubscriptionPlan, UserSubscription, get_db
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
from src.websocket.hub import AgentAttentionInfo, emit_agent_attention, emit_to_session

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


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


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state.

    Raises:
        HTTPException: If user is not authenticated.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(user_id)


async def verify_session_access(
    session_id: str,
    request: Request,
    db: AsyncSession,
) -> SessionModel:
    """Verify the current user has access to the session.

    Raises:
        HTTPException: If session not found or user lacks access.
    """
    user_id = get_current_user_id(request)

    session_query = select(SessionModel).where(SessionModel.id == session_id)
    session_result = await db.execute(session_query)
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return session


async def check_agent_quota(db: AsyncSession, user_id: str, session_id: str) -> None:
    """Check if user has reached their agent quota for a session.

    Args:
        db: Database session
        user_id: User ID to check
        session_id: Session ID where agent will be created

    Raises:
        HTTPException: If user has exceeded their agent quota
    """
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
        # No active subscription - use free tier limits (2 agents per session)
        max_agents = 2
    else:
        # Get plan limits
        plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id)
        )
        plan = plan_result.scalar_one_or_none()
        max_agents = plan.max_agents if plan else 2

    # Count current agents in this session
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
    model: str
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
            raise ValueError(f"Invalid mode. Must be one of: {list(VALID_AGENT_MODES)}")  # noqa: TRY003
        return mode_lower


class AgentResponse(BaseModel):
    """Agent response."""

    id: str
    session_id: str
    name: str
    role: str
    model: str
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
            raise ValueError(f"Invalid mode. Must be one of: {list(VALID_AGENT_MODES)}")  # noqa: TRY003
        return mode_lower


class ImageAttachment(BaseModel):
    """Image attachment for agent messages."""

    type: str = "image"  # image, screenshot, file
    url: str | None = None  # URL to image in workspace
    base64_data: str | None = None  # Base64 encoded image data
    content_type: str = "image/png"  # MIME type
    filename: str | None = None  # Original filename


class MessageCreate(BaseModel):
    """Create message request."""

    content: str
    images: list[ImageAttachment] | None = None  # Optional image attachments

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
            raise ValueError(f"Maximum {max_images} images allowed per message")  # noqa: TRY003
        for img in v:
            if img.base64_data:
                # Remove data URL prefix for size calculation
                data = img.base64_data
                if data.startswith("data:"):
                    data = data.split(",", 1)[1] if "," in data else data
                # Base64 is ~4/3 the size of binary
                estimated_size = len(data) * 3 // 4
                if estimated_size > max_size:
                    raise ValueError(  # noqa: TRY003
                        f"Image too large. Maximum size is {max_size // (1024 * 1024)}MB"
                    )
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
    "custom": "You are a helpful AI assistant.",
}

# ==================== Agent Attention Detection ====================

# Patterns that indicate the agent needs user approval
APPROVAL_PATTERNS = [
    r"(?:awaiting|waiting for) (?:your )?approval",
    r"please (?:review|approve|confirm)",
    r"shall I proceed\??",
    r"do you want me to (?:proceed|continue|go ahead)",
    r"would you like me to (?:proceed|continue|go ahead|implement|execute)",
    r"ready to (?:proceed|implement|execute).*\?",
    r"before I (?:proceed|continue|start)",
    r"let me know (?:if|when) (?:you'?re ready|I should)",
    r"approve (?:this|the) plan",
]

# Patterns that indicate task completion
COMPLETION_PATTERNS = [
    r"I'?ve (?:completed|finished|done|implemented)",
    r"implementation is (?:done|complete|finished)",
    r"all (?:tests|files|changes) (?:are )?(?:done|complete|passing)",
    r"task (?:is )?(?:complete|done|finished)",
    r"successfully (?:completed|implemented|created|fixed)",
    r"changes have been (?:made|applied|committed)",
    r"everything (?:is )?(?:set up|configured|ready)",
]

# Patterns that indicate waiting for user input
INPUT_PATTERNS = [
    r"what would you like",
    r"please (?:provide|specify|tell me|share|clarify)",
    r"I need (?:more information|clarification|details|input)",
    r"which (?:option|approach|method) would you prefer",
    r"can you (?:provide|specify|clarify|share)",
    r"could you (?:provide|specify|clarify|share|tell me)",
    r"what (?:should|would) you like me to",
    r"how would you like me to",
]


def detect_attention_type(response: str, _agent_role: str) -> str | None:
    """Detect if an agent response requires user attention.

    Args:
        response: The agent's response content.
        _agent_role: The agent's role (architect, coder, etc.). Reserved for future use.

    Returns:
        The attention type if attention is needed, None otherwise.
    """
    response_lower = response.lower()

    # Check for approval patterns (highest priority)
    for pattern in APPROVAL_PATTERNS:
        if re.search(pattern, response_lower, re.IGNORECASE):
            return "needs_approval"

    # Check for completion patterns
    for pattern in COMPLETION_PATTERNS:
        if re.search(pattern, response_lower, re.IGNORECASE):
            return "completed"

    # Check for input patterns
    for pattern in INPUT_PATTERNS:
        if re.search(pattern, response_lower, re.IGNORECASE):
            return "waiting_input"

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


def _build_agent_service_context(ctx: AgentMessageContext) -> dict[str, Any]:
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


async def _process_and_emit_response(
    processing_ctx: ResponseProcessingContext,
) -> None:
    """Process agent response: create message, emit events, check attention."""
    db = processing_ctx.db
    ctx = processing_ctx.ctx
    agent = processing_ctx.agent
    response_content = processing_ctx.response_content
    auto_play = processing_ctx.auto_play
    tool_calls = processing_ctx.tool_calls

    tts_result = generate_tts_summary(response_content)
    tts_summary = tts_result.summary if tts_result.was_summarized else None

    assistant_message = MessageModel(
        agent_id=ctx.agent_id,
        role="assistant",
        content=response_content,
        tts_summary=tts_summary,
    )
    db.add(assistant_message)
    await db.flush()
    await db.refresh(assistant_message)

    agent.status = "idle"
    await db.commit()

    await _emit_agent_response(
        ctx,
        assistant_message,
        response_content,
        tts_summary,
        auto_play=auto_play,
        tool_calls=tool_calls,
    )
    await _notify_agent_status(ctx.session_id, ctx.agent_id, "idle")

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


async def process_agent_message(ctx: AgentMessageContext) -> None:  # noqa: PLR0915
    """Background task to process agent message and generate response.

    Calls the agent service to process the message with the LLM.
    Falls back to simulated responses in development if agent service unavailable.

    Args:
        ctx: The agent message context containing all required parameters.
    """
    # Create a new database session for the background task
    async with async_session_factory() as db:
        try:
            # Update agent status to active with row-level locking to prevent race conditions
            agent_query = select(AgentModel).where(AgentModel.id == ctx.agent_id).with_for_update()
            result = await db.execute(agent_query)
            agent = result.scalar_one_or_none()

            if not agent:
                logger.warning("Agent not found for message processing", agent_id=ctx.agent_id)
                return

            agent.status = "active"
            await db.commit()

            # Get voice config for auto-play
            voice_config = agent.voice_config or {}
            auto_play = voice_config.get("auto_play", False)

            # Notify frontend that agent is processing
            await _notify_agent_status(ctx.session_id, ctx.agent_id, "active")

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

            # Build context for agent service and call agent
            agent_context = _build_agent_service_context(ctx)
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
            processing_ctx = ResponseProcessingContext(
                db=db,
                ctx=ctx,
                agent=agent,
                response_content=response_content,
                auto_play=auto_play,
                tool_calls=tool_calls,
            )
            await _process_and_emit_response(processing_ctx)

            # Update context token tracking and emit update
            if tokens_used > 0:
                agent.context_tokens_used += tokens_used
                await db.commit()

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
                        "error": str(e)[:500],  # Truncate error message
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

    # Check agent quota before creating
    await check_agent_quota(db, session.owner_id, session_id)

    # If template_id provided, verify it exists and increment usage count atomically
    template = None
    if data.template_id:
        template_query = select(AgentTemplate).where(AgentTemplate.id == data.template_id)
        template_result = await db.execute(template_query)
        template = template_result.scalar_one_or_none()

        if not template:
            raise HTTPException(status_code=404, detail="Agent template not found")

        # Increment usage count atomically to avoid race conditions
        await db.execute(
            update(AgentTemplate)
            .where(AgentTemplate.id == data.template_id)
            .values(usage_count=AgentTemplate.usage_count + 1),
        )

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

    # Create agent
    agent = AgentModel(
        session_id=session_id,
        name=data.name,
        role=role,
        model=template.model if template else data.model,
        status="idle",
        mode=data.mode,
        command_allowlist=data.command_allowlist,
        config=config,
        template_id=data.template_id,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    return AgentResponse(
        id=agent.id,
        session_id=agent.session_id,
        name=agent.name,
        role=agent.role,
        model=agent.model,
        status=agent.status,
        mode=agent.mode,
        command_allowlist=agent.command_allowlist,
        config=agent.config,
        template_id=agent.template_id,
        created_at=agent.created_at,
    )


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

    return [
        AgentResponse(
            id=a.id,
            session_id=a.session_id,
            name=a.name,
            role=a.role,
            model=a.model,
            status=a.status,
            mode=a.mode,
            command_allowlist=a.command_allowlist,
            config=a.config,
            template_id=a.template_id,
            created_at=a.created_at,
        )
        for a in agents
    ]


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

    return AgentResponse(
        id=agent.id,
        session_id=agent.session_id,
        name=agent.name,
        role=agent.role,
        model=agent.model,
        status=agent.status,
        mode=agent.mode,
        command_allowlist=agent.command_allowlist,
        config=agent.config,
        template_id=agent.template_id,
        created_at=agent.created_at,
    )


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

    return AgentResponse(
        id=agent.id,
        session_id=agent.session_id,
        name=agent.name,
        role=agent.role,
        model=agent.model,
        status=agent.status,
        mode=agent.mode,
        command_allowlist=agent.command_allowlist,
        config=agent.config,
        template_id=agent.template_id,
        created_at=agent.created_at,
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
    """Implementation of get_messages endpoint."""
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

    # Get messages with pagination
    query = (
        select(MessageModel)
        .where(MessageModel.agent_id == params.agent_id)
        .order_by(MessageModel.created_at)
        .offset(params.pagination.offset)
        .limit(params.pagination.limit)
    )
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
) -> list[MessageResponse]:
    """Get agent conversation history with pagination.

    Args:
        limit: Maximum number of messages to return (default 100, max 500).
        offset: Number of messages to skip (for pagination).
    """
    common = CommonDeps(request=request, db=db)
    params = GetMessagesParams(
        session_id=session_id,
        agent_id=agent_id,
        pagination=PaginationParams(limit=limit, offset=offset),
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
