"""Claude Code session management API routes.

These routes allow Podex to discover, view, and sync Claude Code sessions
from the user's local machine via their connected local pod.
"""

from typing import Annotated, Any
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.connection import get_db
from src.database.models import (
    Agent,
    LocalPod,
    Message,
    Session,
    TerminalAgentSession,
    TerminalIntegratedAgentType,
    Workspace,
)
from src.middleware.auth import get_current_user
from src.websocket.local_pod_hub import (
    PodNotConnectedError,
    RPCMethods,
    call_pod,
    is_pod_online,
)

router = APIRouter(prefix="/claude-sessions", tags=["claude-sessions"])
logger = structlog.get_logger()

# Type aliases
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[dict[str, str | None], Depends(get_current_user)]


# ============== Request/Response Models ==============


class ClaudeProjectResponse(BaseModel):
    """Project with Claude Code sessions."""

    path: str
    encoded_path: str
    session_count: int
    last_modified: str


class ClaudeProjectsResponse(BaseModel):
    """List of projects with Claude sessions."""

    projects: list[ClaudeProjectResponse]
    total: int


class ClaudeSessionSummary(BaseModel):
    """Summary of a Claude Code session."""

    session_id: str
    first_prompt: str
    message_count: int
    created_at: str
    modified_at: str
    git_branch: str
    project_path: str
    is_sidechain: bool
    file_size_bytes: int


class ClaudeSessionsResponse(BaseModel):
    """List of Claude sessions for a project."""

    sessions: list[ClaudeSessionSummary]
    total: int
    project_path: str


class ClaudeMessageResponse(BaseModel):
    """Message from a Claude session.

    Includes all fields needed by the frontend to render different entry types:
    - user/assistant messages with tool calls and thinking
    - progress events with tool execution data
    - summary entries
    - config/mode changes
    """

    uuid: str
    parent_uuid: str | None = None
    role: str
    content: str
    timestamp: str | None = None
    model: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    # Extended fields for full message rendering
    type: str | None = None  # Entry type: user, assistant, progress, summary, etc.
    thinking: str | None = None  # Extended thinking content
    tool_results: list[dict[str, Any]] | None = None  # Tool result blocks
    usage: dict[str, Any] | None = None  # Token usage info
    stop_reason: str | None = None  # Why the model stopped
    is_sidechain: bool = False  # Sidechain message flag
    # Progress event fields
    progress_type: str | None = None  # Type of progress event
    data: dict[str, Any] | None = None  # Progress event data
    tool_use_id: str | None = None  # Tool use ID for progress events
    parent_tool_use_id: str | None = None  # Parent tool use ID
    # Summary fields
    summary: str | None = None  # Summary content
    leaf_uuid: str | None = None  # Leaf message UUID for summaries
    # Config/mode fields
    mode: str | None = None  # Agent mode (ask, auto, plan, sovereign)
    config_data: dict[str, Any] | None = None  # Config change data


class ClaudeSessionDetailResponse(BaseModel):
    """Detailed Claude session with messages."""

    session_id: str
    first_prompt: str
    message_count: int
    created_at: str
    modified_at: str
    git_branch: str
    project_path: str
    is_sidechain: bool
    messages: list[ClaudeMessageResponse] = []


class ClaudeMessagesResponse(BaseModel):
    """Messages from a Claude session."""

    messages: list[ClaudeMessageResponse]
    total: int
    session_id: str


class SyncRequest(BaseModel):
    """Request to sync a Claude session to Podex."""

    session_id: str
    project_path: str
    podex_session_id: str | None = Field(None, description="Existing Podex session to link to")
    agent_name: str = Field(default="Claude Code", description="Name for the synced agent")


class SyncResponse(BaseModel):
    """Response from syncing a Claude session."""

    podex_session_id: str
    agent_id: str
    messages_synced: int
    claude_session_id: str


class ResumeRequest(BaseModel):
    """Request to resume a Claude session in a terminal."""

    session_id: str
    project_path: str
    workspace_id: str | None = Field(None, description="Workspace ID for terminal")
    first_prompt: str | None = Field(
        None, description="First prompt/title of the session for display"
    )


class ResumeResponse(BaseModel):
    """Response from resuming a Claude session."""

    terminal_session_id: str
    claude_session_id: str
    workspace_id: str
    working_dir: str
    # Claude session info for cross-device sync
    claude_project_path: str
    claude_first_prompt: str | None = None


# ============== Helper Functions ==============


async def get_user_pod(db: AsyncSession, user_id: str | None) -> LocalPod:
    """Get the user's connected local pod."""
    if not user_id:
        raise HTTPException(status_code=401, detail="User ID is required")

    result = await db.execute(
        select(LocalPod).where(
            LocalPod.user_id == user_id,
            LocalPod.status == "online",
        )
    )
    pod = result.scalar_one_or_none()

    if not pod:
        raise HTTPException(
            status_code=404,
            detail="No connected local pod found. Please connect your local pod first.",
        )

    if not is_pod_online(str(pod.id)):
        raise HTTPException(
            status_code=503,
            detail="Local pod is not currently connected.",
        )

    return pod


# ============== API Endpoints ==============


@router.get("/projects", response_model=ClaudeProjectsResponse)
async def list_claude_projects(
    db: DbSession,
    user: CurrentUser,
) -> ClaudeProjectsResponse:
    """List all local projects that have Claude Code sessions.

    Requires a connected local pod.
    """
    pod = await get_user_pod(db, user["id"])

    try:
        result = await call_pod(
            str(pod.id),
            RPCMethods.CLAUDE_LIST_PROJECTS,
            {},
        )
    except (PodNotConnectedError, ConnectionError):
        raise HTTPException(status_code=503, detail="Local pod disconnected")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Request to local pod timed out")

    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    # Type narrowing for mypy - call_pod returns object but we expect dict
    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="Unexpected response from pod")
    return ClaudeProjectsResponse(
        projects=[ClaudeProjectResponse(**p) for p in result.get("projects", [])],
        total=result.get("total", 0),
    )


@router.get("/sessions", response_model=ClaudeSessionsResponse)
async def list_claude_sessions(
    db: DbSession,
    user: CurrentUser,
    project_path: str = Query(..., description="Project path to list sessions for"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("modified", pattern="^(created|modified|message_count)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
) -> ClaudeSessionsResponse:
    """List Claude Code sessions for a project.

    Requires a connected local pod.
    """
    pod = await get_user_pod(db, user["id"])

    try:
        result = await call_pod(
            str(pod.id),
            RPCMethods.CLAUDE_LIST_SESSIONS,
            {
                "project_path": project_path,
                "limit": limit,
                "offset": offset,
                "sort_by": sort_by,
                "sort_order": sort_order,
            },
        )
    except (PodNotConnectedError, ConnectionError):
        raise HTTPException(status_code=503, detail="Local pod disconnected")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Request to local pod timed out")

    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    # Type narrowing for mypy - call_pod returns object but we expect dict
    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="Unexpected response from pod")
    return ClaudeSessionsResponse(
        sessions=[ClaudeSessionSummary(**s) for s in result.get("sessions", [])],
        total=result.get("total", 0),
        project_path=result.get("project_path", project_path),
    )


@router.get("/sessions/{session_id}", response_model=ClaudeSessionDetailResponse)
async def get_claude_session(
    db: DbSession,
    user: CurrentUser,
    session_id: str,
    project_path: str = Query(..., description="Project path for the session"),
    include_messages: bool = Query(True),
    message_limit: int = Query(100, ge=1, le=500),
) -> ClaudeSessionDetailResponse:
    """Get details of a specific Claude Code session.

    Requires a connected local pod.
    """
    pod = await get_user_pod(db, user["id"])

    try:
        result = await call_pod(
            str(pod.id),
            RPCMethods.CLAUDE_GET_SESSION,
            {
                "project_path": project_path,
                "session_id": session_id,
                "include_messages": include_messages,
                "message_limit": message_limit,
            },
        )
    except (PodNotConnectedError, ConnectionError):
        raise HTTPException(status_code=503, detail="Local pod disconnected")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Request to local pod timed out")

    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    # Type narrowing for mypy - call_pod returns object but we expect dict
    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="Unexpected response from pod")
    session = result.get("session", {})

    # Convert messages, ensuring role and content have values
    messages = []
    for m in session.get("messages", []):
        if not m.get("uuid"):
            continue
        if not m.get("role"):
            m["role"] = m.get("type", "unknown")
        if m.get("content") is None:
            m["content"] = ""
        messages.append(ClaudeMessageResponse(**m))

    return ClaudeSessionDetailResponse(
        session_id=session.get("session_id", ""),
        first_prompt=session.get("first_prompt", ""),
        message_count=session.get("message_count", 0),
        created_at=session.get("created_at", ""),
        modified_at=session.get("modified_at", ""),
        git_branch=session.get("git_branch", ""),
        project_path=session.get("project_path", project_path),
        is_sidechain=session.get("is_sidechain", False),
        messages=messages,
    )


@router.get("/sessions/{session_id}/messages", response_model=ClaudeMessagesResponse)
async def get_claude_session_messages(
    db: DbSession,
    user: CurrentUser,
    session_id: str,
    project_path: str = Query(..., description="Project path for the session"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    reverse: bool = Query(
        False,
        description="If true, return messages in reverse order (newest first)",
    ),
) -> ClaudeMessagesResponse:
    """Get messages from a Claude Code session.

    Requires a connected local pod.

    The `reverse` parameter enables bottom-up loading:
    - reverse=False (default): Messages in chronological order (oldest first)
    - reverse=True: Messages in reverse chronological order (newest first)

    For efficient loading, use reverse=True with pagination to load the latest
    messages first, then progressively load older messages in batches.
    """
    pod = await get_user_pod(db, user["id"])

    try:
        result = await call_pod(
            str(pod.id),
            RPCMethods.CLAUDE_GET_MESSAGES,
            {
                "project_path": project_path,
                "session_id": session_id,
                "limit": limit,
                "offset": offset,
                "reverse": reverse,
            },
        )
    except (PodNotConnectedError, ConnectionError):
        raise HTTPException(status_code=503, detail="Local pod disconnected")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Request to local pod timed out")

    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    # Type narrowing for mypy - call_pod returns object but we expect dict
    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="Unexpected response from pod")

    # Convert messages, filtering only entries without uuid
    # Content can be empty (e.g., user messages with only tool results)
    # Role defaults to entry type if not set
    messages = []
    for m in result.get("messages", []):
        if not m.get("uuid"):
            continue  # Skip entries without uuid (shouldn't happen with generated uuids)
        # Ensure role has a value (fall back to type or default)
        if not m.get("role"):
            m["role"] = m.get("type", "unknown")
        # Ensure content exists (empty string is valid)
        if m.get("content") is None:
            m["content"] = ""
        messages.append(ClaudeMessageResponse(**m))

    return ClaudeMessagesResponse(
        messages=messages,
        total=result.get("total", 0),
        session_id=session_id,
    )


@router.post("/sync", response_model=SyncResponse)
async def sync_claude_session(
    db: DbSession,
    user: CurrentUser,
    request: SyncRequest,
) -> SyncResponse:
    """Sync a Claude Code session to Podex database.

    This creates a Podex session with an agent and imports all messages.
    Messages are stored in the database for search, analytics, and persistence.

    Deduplication: If the same Claude session has already been synced, this will
    return the existing agent and skip importing duplicate messages.
    """
    pod = await get_user_pod(db, user["id"])

    # Get session data from local pod
    try:
        result = await call_pod(
            str(pod.id),
            RPCMethods.CLAUDE_SYNC_SESSION,
            {
                "project_path": request.project_path,
                "session_id": request.session_id,
            },
        )
    except (PodNotConnectedError, ConnectionError):
        raise HTTPException(status_code=503, detail="Local pod disconnected")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Request to local pod timed out")

    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    # Type narrowing for mypy - call_pod returns object but we expect dict
    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="Unexpected response from pod")
    sync_data = result.get("sync_data", {})
    if not sync_data:
        raise HTTPException(status_code=404, detail="No session data returned")

    claude_session_id = sync_data.get("claude_session_id", request.session_id)

    # Check if this Claude session has already been synced
    # Look for an existing agent with the same claude_session_id in config
    existing_agent_result = await db.execute(
        select(Agent).where(Agent.config["claude_session_id"].astext == claude_session_id)
    )
    existing_agent = existing_agent_result.scalar_one_or_none()

    if existing_agent:
        # Session already synced - return existing data without creating duplicates
        return SyncResponse(
            podex_session_id=str(existing_agent.session_id),
            agent_id=str(existing_agent.id),
            messages_synced=0,  # No new messages synced
            claude_session_id=claude_session_id,
        )

    # Create or get Podex session
    if request.podex_session_id:
        # Link to existing session
        session_result = await db.execute(
            select(Session).where(
                Session.id == request.podex_session_id,
                Session.owner_id == user["id"],
            )
        )
        podex_session = session_result.scalar_one_or_none()
        if not podex_session:
            raise HTTPException(status_code=404, detail="Podex session not found")
    else:
        # Create new session
        podex_session = Session(
            name=f"Claude: {sync_data.get('first_prompt', 'Session')[:50]}",
            owner_id=user["id"],
            branch=sync_data.get("git_branch", "main"),
            settings={
                "claude_session_id": claude_session_id,
                "project_path": sync_data.get("project_path"),
                "synced_from_claude": True,
            },
        )
        db.add(podex_session)
        await db.flush()

    # Create agent for the Claude session
    agent = Agent(
        session_id=podex_session.id,
        name=request.agent_name,
        role="assistant",
        model="claude-code",
        kind="terminal_external",
        config={
            "claude_session_id": claude_session_id,
            "project_path": sync_data.get("project_path"),
            "original_message_count": sync_data.get("message_count"),
        },
    )
    db.add(agent)
    await db.flush()

    # Import messages (filter out malformed entries without required fields)
    messages_synced = 0
    for msg in sync_data.get("messages", []):
        # Skip malformed messages that don't have required fields
        if not msg.get("role") or msg.get("content") is None:
            continue
        message = Message(
            agent_id=agent.id,
            role=msg.get("role", "user"),
            content=msg.get("content", ""),
            tool_calls=msg.get("tool_calls"),
        )
        db.add(message)
        messages_synced += 1

    await db.commit()

    return SyncResponse(
        podex_session_id=str(podex_session.id),
        agent_id=str(agent.id),
        messages_synced=messages_synced,
        claude_session_id=claude_session_id,
    )


@router.post("/resume", response_model=ResumeResponse)
async def resume_claude_session(
    db: DbSession,
    user: CurrentUser,
    request: ResumeRequest,
) -> ResumeResponse:
    """Resume a Claude Code session in a terminal.

    Creates a terminal running `claude --resume <session_id>`.
    """
    pod = await get_user_pod(db, user["id"])

    # Get workspace working directory if provided
    working_dir = request.project_path
    workspace_id = request.workspace_id

    if workspace_id:
        workspace_result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one_or_none()
        if workspace and workspace.session:
            # Get working_dir from session settings if available
            settings = workspace.session.settings or {}
            if settings.get("working_dir"):
                working_dir = settings["working_dir"]

    # Generate a proper UUID for the terminal session ID
    # This will be used as both the tmux session name and the database record ID
    generated_terminal_session_id = str(uuid4())

    try:
        result = await call_pod(
            str(pod.id),
            RPCMethods.CLAUDE_RESUME_SESSION,
            {
                "session_id": request.session_id,
                "working_dir": working_dir,
                "workspace_id": workspace_id or f"claude-{request.session_id[:8]}",
                "terminal_session_id": generated_terminal_session_id,
            },
        )
    except (PodNotConnectedError, ConnectionError):
        raise HTTPException(status_code=503, detail="Local pod disconnected")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Request to local pod timed out")

    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    # Type narrowing for mypy - call_pod returns object but we expect dict
    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="Unexpected response from pod")
    terminal_session_id = result.get("terminal_session_id", "")
    result_workspace_id = result.get("workspace_id", "")
    result_working_dir = result.get("working_dir", working_dir)

    # Get or create the Claude Code agent type
    agent_type_result = await db.execute(
        select(TerminalIntegratedAgentType).where(TerminalIntegratedAgentType.slug == "claude-code")
    )
    agent_type = agent_type_result.scalar_one_or_none()
    if not agent_type:
        raise HTTPException(
            status_code=500,
            detail="Claude Code agent type not configured. Please contact support.",
        )

    # Create a TerminalAgentSession record for the WebSocket handler to verify
    # Check if one already exists first (e.g., from a previous resume attempt)
    existing_result = await db.execute(
        select(TerminalAgentSession).where(TerminalAgentSession.id == terminal_session_id)
    )
    existing_session = existing_result.scalar_one_or_none()

    # Get the Claude session ID from result (local pod may normalize it)
    claude_session_id = result.get("claude_session_id", request.session_id)

    if existing_session:
        # Update status and Claude session info
        existing_session.status = "running"
        existing_session.claude_session_id = claude_session_id
        existing_session.claude_project_path = request.project_path
        existing_session.claude_first_prompt = request.first_prompt
    else:
        # Create new session record with Claude session info
        db_session = TerminalAgentSession(
            id=terminal_session_id,
            user_id=user["id"],
            workspace_id=result_workspace_id,
            agent_type_id=str(agent_type.id),
            status="running",
            # Claude Code session info for cross-device sync
            claude_session_id=claude_session_id,
            claude_project_path=request.project_path,
            claude_first_prompt=request.first_prompt,
        )
        db.add(db_session)

    await db.commit()

    # Register the terminal session with the terminal session manager so output can be routed
    # The local-pod has already created the tmux session and started streaming output,
    # but the server needs a registered session to route output to frontend clients.
    # Import here to avoid circular imports
    from src.routes.terminal_agents import terminal_session_manager  # noqa: PLC0415

    await terminal_session_manager.register_external_session(
        session_id=terminal_session_id,
        workspace_id=result_workspace_id,
        working_dir=result_working_dir,
    )

    return ResumeResponse(
        terminal_session_id=terminal_session_id,
        claude_session_id=claude_session_id,
        workspace_id=result_workspace_id,
        working_dir=result_working_dir,
        # Claude session info for cross-device sync
        claude_project_path=request.project_path,
        claude_first_prompt=request.first_prompt,
    )


# ============== Watch/Unwatch for Real-Time Sync ==============


class WatchRequest(BaseModel):
    """Request to register a Claude session for real-time file watching."""

    claude_session_id: str
    project_path: str
    podex_session_id: str
    podex_agent_id: str
    last_synced_uuid: str | None = Field(
        None, description="UUID of the last synced message (skip messages before this)"
    )


class WatchResponse(BaseModel):
    """Response from watch registration."""

    status: str  # "registered" or "error"
    claude_session_id: str
    podex_session_id: str
    podex_agent_id: str
    error: str | None = None


class UnwatchRequest(BaseModel):
    """Request to unregister a Claude session from file watching."""

    claude_session_id: str
    project_path: str
    podex_agent_id: str | None = None  # Optional for backwards compatibility


class UnwatchResponse(BaseModel):
    """Response from unwatch."""

    status: str


@router.post("/watch", response_model=WatchResponse)
async def watch_claude_session(
    db: DbSession,
    user: CurrentUser,
    request: WatchRequest,
) -> WatchResponse:
    """Register a Claude Code session for real-time file watching.

    The local pod's file watcher will monitor the session JSONL file and push
    new messages to Podex via WebSocket in real-time.

    This enables bi-directional sync:
    - When a user works in VS Code with Claude, messages appear in Podex Web
    - When a user sends messages via Podex Web, they go to the same Claude session

    Also persists the Claude session info to the Agent config so that the
    sync can survive local pod restarts (the backend can query active watchers).
    """
    # Persist Claude session info to the Agent config
    # This allows the backend to query for watchers even after local pod restart
    agent_result = await db.execute(select(Agent).where(Agent.id == request.podex_agent_id))
    agent = agent_result.scalar_one_or_none()
    if agent:
        # Update agent config with Claude session info
        # Use dict() to create a new dict so SQLAlchemy detects the change
        config = dict(agent.config or {})
        config["claude_session_id"] = request.claude_session_id
        config["claude_project_path"] = request.project_path
        agent.config = config
        await db.commit()
        logger.info(
            "Persisted Claude session info to agent",
            agent_id=request.podex_agent_id,
            claude_session_id=request.claude_session_id,
            project_path=request.project_path,
        )

    pod = await get_user_pod(db, user["id"])

    try:
        result = await call_pod(
            str(pod.id),
            RPCMethods.CLAUDE_WATCH_SESSION,
            {
                "claude_session_id": request.claude_session_id,
                "project_path": request.project_path,
                "podex_session_id": request.podex_session_id,
                "podex_agent_id": request.podex_agent_id,
                "last_synced_uuid": request.last_synced_uuid,
            },
        )
    except (PodNotConnectedError, ConnectionError):
        raise HTTPException(status_code=503, detail="Local pod disconnected")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Request to local pod timed out")

    if isinstance(result, dict) and "error" in result:
        return WatchResponse(
            status="error",
            claude_session_id=request.claude_session_id,
            podex_session_id=request.podex_session_id,
            podex_agent_id=request.podex_agent_id,
            error=str(result["error"]),
        )

    # Type narrowing for mypy
    if not isinstance(result, dict):
        return WatchResponse(
            status="error",
            claude_session_id=request.claude_session_id,
            podex_session_id=request.podex_session_id,
            podex_agent_id=request.podex_agent_id,
            error="Unexpected response from pod",
        )

    return WatchResponse(
        status=result.get("status", "registered"),
        claude_session_id=request.claude_session_id,
        podex_session_id=request.podex_session_id,
        podex_agent_id=request.podex_agent_id,
    )


@router.post("/unwatch", response_model=UnwatchResponse)
async def unwatch_claude_session(
    db: DbSession,
    user: CurrentUser,
    request: UnwatchRequest,
) -> UnwatchResponse:
    """Unregister a Claude Code session from real-time file watching.

    Called when a user unlinks a Claude session from a Podex agent.
    Also clears the Claude session info from the agent config to prevent
    stale watcher entries.
    """
    # Clear Claude session info from agent config if podex_agent_id provided
    # BUT only if the config matches the session being unwatched (prevents race condition
    # where React cleanup from previous render clears a newly-set config)
    if request.podex_agent_id:
        agent_result = await db.execute(select(Agent).where(Agent.id == request.podex_agent_id))
        agent = agent_result.scalar_one_or_none()
        if agent and agent.config:
            stored_session_id = agent.config.get("claude_session_id")
            stored_project_path = agent.config.get("claude_project_path")
            # Only clear if the stored values match what we're unwatching
            if (
                stored_session_id == request.claude_session_id
                and stored_project_path == request.project_path
            ):
                config = agent.config.copy()
                config.pop("claude_session_id", None)
                config.pop("claude_project_path", None)
                agent.config = config
                await db.commit()
                logger.info(
                    "Cleared Claude session info from agent",
                    agent_id=request.podex_agent_id,
                )
            else:
                logger.debug(
                    "Skipped clearing config - session mismatch (likely race condition)",
                    agent_id=request.podex_agent_id,
                    stored_session_id=stored_session_id,
                    request_session_id=request.claude_session_id,
                )

    pod = await get_user_pod(db, user["id"])

    try:
        result = await call_pod(
            str(pod.id),
            RPCMethods.CLAUDE_UNWATCH_SESSION,
            {
                "claude_session_id": request.claude_session_id,
                "project_path": request.project_path,
            },
        )
    except (PodNotConnectedError, ConnectionError):
        raise HTTPException(status_code=503, detail="Local pod disconnected")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Request to local pod timed out")

    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return UnwatchResponse(status="unregistered")
