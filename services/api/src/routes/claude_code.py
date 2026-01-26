"""Claude Code API routes for native Claude Code integration.

These routes handle Claude Code-specific functionality like:
- Checking/managing authentication status
- Running slash commands
- Managing custom commands
- Re-authentication flow
"""

from __future__ import annotations

import json
import re
import shlex
import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import Agent as AgentModel
from src.database import Session as SessionModel
from src.database import Workspace as WorkspaceModel
from src.routes.dependencies import DbSession, get_current_user_id, verify_session_access
from src.routes.sessions import ensure_workspace_provisioned, update_workspace_activity
from src.services.claude_code_config import sync_claude_code_mcp_config
from src.services.workspace_router import workspace_router
from src.websocket.hub import (
    emit_agent_thinking_token,
    emit_agent_token,
    emit_permission_request,
    store_pending_permission_context,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/claude-code", tags=["claude-code"])


# ==================== Request/Response Models ====================


class AuthStatusResponse(BaseModel):
    """Claude Code authentication status."""

    authenticated: bool
    needs_auth: bool
    credentials_synced: bool = False


class SlashCommand(BaseModel):
    """Slash command definition."""

    name: str
    description: str
    builtin: bool = False


class CustomCommandCreate(BaseModel):
    """Create custom slash command request."""

    name: str
    description: str
    command: str  # The actual command to execute


class CustomCommandResponse(BaseModel):
    """Custom slash command response."""

    id: str
    name: str
    description: str
    command: str
    created_at: str


class ExecuteCommandRequest(BaseModel):
    """Execute a slash command request."""

    command: str  # e.g., "help", "clear", "config"
    args: str | None = None


class ExecuteCommandResponse(BaseModel):
    """Execute command response."""

    success: bool
    output: str | None = None
    error: str | None = None


# ==================== Built-in Slash Commands ====================

BUILTIN_COMMANDS: list[SlashCommand] = [
    SlashCommand(name="help", description="Show all available commands", builtin=True),
    SlashCommand(name="clear", description="Clear conversation history", builtin=True),
    SlashCommand(name="compact", description="Compact context to reduce tokens", builtin=True),
    SlashCommand(name="config", description="View/modify configuration", builtin=True),
    SlashCommand(name="model", description="Switch model (e.g., /model opus)", builtin=True),
    SlashCommand(name="status", description="Show current status", builtin=True),
    SlashCommand(name="rewind", description="Rewind to previous state", builtin=True),
    SlashCommand(name="vim", description="Toggle Vim keybindings", builtin=True),
    SlashCommand(name="bug", description="Report a bug", builtin=True),
    SlashCommand(name="login", description="Authenticate with Anthropic", builtin=True),
    SlashCommand(name="logout", description="Clear authentication", builtin=True),
    SlashCommand(name="doctor", description="Run diagnostics", builtin=True),
    SlashCommand(name="cost", description="Show cost and token usage", builtin=True),
    SlashCommand(name="context", description="Show context information", builtin=True),
    SlashCommand(name="review", description="Review recent changes", builtin=True),
    SlashCommand(name="init", description="Initialize CLAUDE.md in project", builtin=True),
    SlashCommand(name="pr-comments", description="Review PR comments", builtin=True),
]

# Set of built-in command names for quick lookup
BUILTIN_COMMAND_NAMES = {cmd.name for cmd in BUILTIN_COMMANDS}


def is_builtin_cli_command(message: str) -> tuple[bool, str, str]:
    """Check if a message is a built-in CLI command.

    Args:
        message: The message to check

    Returns:
        Tuple of (is_builtin, command_name, args)
    """
    message = message.strip()
    if not message.startswith("/"):
        return False, "", ""

    # Parse the command
    parts = message[1:].split(maxsplit=1)  # Remove leading /
    if not parts:
        return False, "", ""

    command_name = parts[0].lower()
    args = parts[1] if len(parts) > 1 else ""

    if command_name in BUILTIN_COMMAND_NAMES:
        return True, command_name, args

    return False, "", ""


async def _execute_builtin_command(
    workspace_id: str,
    user_id: str,
    command_name: str,
    args: str,
    cli_session_id: str | None = None,
) -> dict[str, Any]:
    """Execute a built-in Claude CLI slash command via the -p flag.

    Built-in slash commands like /status, /cost need to be passed
    via `-p "/status"` to execute as commands within a Claude session.
    The session ID is required for proper context when running these commands.

    Args:
        workspace_id: The workspace ID
        user_id: User ID for authorization
        command_name: The command name (without /)
        args: Optional command arguments
        cli_session_id: Claude Code session ID to resume (for slash command context)

    Returns:
        Dict with response content and metadata
    """
    # Build the command - slash commands must be passed via -p flag
    # Running `claude /status` directly treats it as a "skill" argument
    # Instead, we need `claude -p "/status"` to execute the slash command
    # The --resume flag is needed for slash commands to have proper session context
    slash_cmd = f"/{command_name}"
    if args:
        slash_cmd = f"{slash_cmd} {args}"
    cmd_parts = ["PATH=/home/dev/.npm-global/bin:$PATH", "claude", "-p", shlex.quote(slash_cmd)]

    # Add --resume if we have a session ID - slash commands need session context
    if cli_session_id:
        cmd_parts.extend(["--resume", cli_session_id])

    cmd = " ".join(cmd_parts)

    logger.info(
        "Executing Claude Code built-in command",
        workspace_id=workspace_id,
        command=command_name,
        args=args,
        cli_session_id=cli_session_id if cli_session_id else "(none)",
        has_session=bool(cli_session_id),
    )

    try:
        result = await workspace_router.exec_command(
            workspace_id=workspace_id,
            user_id=user_id,
            command=cmd,
            exec_timeout=30,
        )

        stdout = result.get("stdout", "")
        stderr = result.get("stderr", "")
        exit_code = result.get("exit_code", 0)

        logger.info(
            "Claude Code built-in command completed",
            workspace_id=workspace_id,
            command=command_name,
            exit_code=exit_code,
            output_length=len(stdout),
        )

        # For built-in commands, the output is typically plain text
        content = stdout.strip() if stdout else stderr.strip()

        # Format the output nicely for chat display
        if content:
            # Wrap in a code block for better display
            formatted_content = f"**/{command_name}** output:\n```\n{content}\n```"
        else:
            formatted_content = f"**/{command_name}** completed (no output)"

        return {  # noqa: TRY300
            "content": formatted_content,
            "thinking": None,
            "tool_calls": None,
            "exit_code": exit_code,
            "success": exit_code == 0,
        }

    except Exception as e:
        logger.exception(
            "Claude Code built-in command failed",
            workspace_id=workspace_id,
            command=command_name,
            error=str(e),
        )
        return {
            "content": f"❌ Failed to execute /{command_name}: {e}",
            "thinking": None,
            "tool_calls": None,
            "exit_code": 1,
            "success": False,
        }


# ==================== Helper Functions ====================


async def get_workspace_for_session(
    db: AsyncSession,
    session_id: str,
) -> str | None:
    """Get workspace_id for a session."""
    result = await db.execute(
        select(SessionModel.workspace_id).where(SessionModel.id == session_id)
    )
    row = result.first()
    return row[0] if row else None


async def get_agent_session(
    db: AsyncSession,
    agent_id: str,
) -> tuple[AgentModel | None, SessionModel | None]:
    """Get agent and its session."""
    agent_result = await db.execute(select(AgentModel).where(AgentModel.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        return None, None

    session_result = await db.execute(
        select(SessionModel).where(SessionModel.id == agent.session_id)
    )
    session = session_result.scalar_one_or_none()
    return agent, session


async def is_local_pod_workspace(db: AsyncSession, workspace_id: str) -> bool:
    """Check if a workspace is running on a local pod."""
    result = await db.execute(
        select(WorkspaceModel.local_pod_id).where(WorkspaceModel.id == workspace_id)
    )
    local_pod_id = result.scalar_one_or_none()
    return local_pod_id is not None


# ==================== Authentication Endpoints ====================


@router.get("/agents/{agent_id}/auth-status", response_model=AuthStatusResponse)
async def check_auth_status(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> AuthStatusResponse:
    """Check Claude Code authentication status for an agent.

    Checks if the workspace has valid Claude credentials in ~/.claude/
    """
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Verify user has access to session
    await verify_session_access(session.id, request, db)

    if not session.workspace_id:
        return AuthStatusResponse(
            authenticated=False,
            needs_auth=True,
            credentials_synced=False,
        )

    # Ensure workspace is provisioned before running commands
    try:
        await ensure_workspace_provisioned(session, user_id, db)
        # Update activity timestamp and handle standby->running sync
        await update_workspace_activity(session, db)
    except Exception as e:
        logger.warning(
            "Failed to provision workspace for auth check",
            agent_id=agent_id,
            workspace_id=session.workspace_id,
            error=str(e),
        )
        return AuthStatusResponse(
            authenticated=False,
            needs_auth=True,
            credentials_synced=False,
        )

    try:
        await sync_claude_code_mcp_config(db, session, user_id)
    except Exception as e:
        logger.warning(
            "Failed to sync Claude Code MCP config during auth check",
            agent_id=agent_id,
            workspace_id=session.workspace_id,
            error=str(e),
        )

    # Check authentication status
    # For local pods: Use ~ which expands to user's home directory (OAuth auth)
    # For cloud workspaces: Use /home/dev (API key credentials)
    try:
        is_local = await is_local_pod_workspace(db, session.workspace_id)

        if is_local:
            # Local pods use OAuth authentication - check if claude CLI is accessible
            # and if ~/.claude/ directory exists (indicates user has used Claude locally)
            result = await workspace_router.exec_command(
                workspace_id=session.workspace_id,
                user_id=user_id,
                command=(
                    "which claude >/dev/null 2>&1 && test -d ~/.claude && echo 'authenticated'"
                ),
                exec_timeout=10,
            )
            logger.info(
                "Local pod auth check",
                agent_id=agent_id,
                workspace_id=session.workspace_id,
                is_local=True,
                stdout=result.get("stdout", ""),
                exit_code=result.get("exit_code"),
            )
            authenticated = "authenticated" in result.get("stdout", "")
        else:
            # Cloud workspace - check for API credentials file
            result = await workspace_router.exec_command(
                workspace_id=session.workspace_id,
                user_id=user_id,
                command="test -f /home/dev/.claude/.credentials.json && echo 'exists'",
                exec_timeout=10,
            )
            logger.info(
                "Cloud workspace auth check",
                agent_id=agent_id,
                workspace_id=session.workspace_id,
                is_local=False,
                stdout=result.get("stdout", ""),
                exit_code=result.get("exit_code"),
            )
            authenticated = "exists" in result.get("stdout", "")
    except Exception as e:
        logger.warning(
            "Failed to check Claude credentials",
            agent_id=agent_id,
            workspace_id=session.workspace_id,
            error=str(e),
        )
        authenticated = False

    return AuthStatusResponse(
        authenticated=authenticated,
        needs_auth=not authenticated,
        credentials_synced=authenticated,
    )


@router.post("/agents/{agent_id}/reauthenticate")
async def reauthenticate(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, str]:
    """Clear Claude Code credentials and trigger re-authentication.

    Removes ~/.claude/credentials.json from the workspace.
    The next message will trigger the auth flow.
    """
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    await verify_session_access(session.id, request, db)

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="No workspace associated with session")

    # Check if this is a local pod workspace
    is_local = await is_local_pod_workspace(db, session.workspace_id)

    if is_local:
        # Local pods use OAuth authentication managed by the user's browser.
        # We can't remove OAuth tokens - user needs to run `claude logout` locally.
        logger.info(
            "Reauthenticate requested for local pod (OAuth auth)",
            agent_id=agent_id,
            workspace_id=session.workspace_id,
        )
        return {
            "status": "local_pod",
            "message": (
                "Local pods use browser-based OAuth. "
                "Run 'claude logout' then 'claude' to re-authenticate."
            ),
        }

    # Cloud workspace - remove API credentials file
    try:
        await workspace_router.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="rm -f /home/dev/.claude/.credentials.json",
            exec_timeout=10,
        )
    except Exception as e:
        logger.warning(
            "Failed to remove Claude credentials",
            agent_id=agent_id,
            workspace_id=session.workspace_id,
            error=str(e),
        )

    logger.info(
        "Claude Code credentials cleared",
        agent_id=agent_id,
        user_id=user_id,
    )

    return {"status": "credentials_cleared", "message": "Re-authentication required"}


# ==================== Slash Commands Endpoints ====================


@router.get("/commands", response_model=list[SlashCommand])
async def list_commands(
    request: Request,  # noqa: ARG001
) -> list[SlashCommand]:
    """List all available slash commands.

    Returns built-in Claude Code commands. Custom commands are defined in the
    workspace's .claude/commands/ directory and loaded by Claude Code CLI directly.
    """
    return BUILTIN_COMMANDS


@router.post("/agents/{agent_id}/execute-command", response_model=ExecuteCommandResponse)
async def execute_slash_command(
    agent_id: str,
    data: ExecuteCommandRequest,
    request: Request,
    db: DbSession,
) -> ExecuteCommandResponse:
    """Execute a slash command directly.

    Some commands like /help and /status can be run directly without
    going through the full agent message flow.
    """
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    await verify_session_access(session.id, request, db)

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="No workspace associated with session")

    # Get CLI session ID from agent config for slash command context
    cli_session_id = agent.config.get("cli_session_id") if agent.config else None

    # Use the helper function for built-in commands
    result = await _execute_builtin_command(
        workspace_id=session.workspace_id,
        user_id=user_id,
        command_name=data.command,
        args=data.args or "",
        cli_session_id=cli_session_id,
    )

    if result.get("success"):
        return ExecuteCommandResponse(
            success=True,
            output=result.get("content", ""),
        )
    return ExecuteCommandResponse(
        success=False,
        error=result.get("content", "Command failed"),
    )


# ==================== Claude Code Execution Helper ====================


async def execute_claude_code_message(
    workspace_id: str,
    user_id: str,
    message: str,
    mode: str = "ask",
    model: str = "sonnet",
    allowed_tools: list[str] | None = None,
    denied_tools: list[str] | None = None,
    max_turns: int = 50,
    thinking_budget: int | None = None,
    images: list[dict[str, Any]] | None = None,
    on_config_change: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    cli_session_id: str | None = None,
    session_id: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """Execute a message using Claude Code CLI in a workspace.

    This is a non-streaming execution that returns the complete response.
    For streaming, the agent routes use a different mechanism.

    Args:
        workspace_id: The workspace where Claude CLI is available
        user_id: User ID for authorization
        message: The user message to send to Claude Code
        mode: Operation mode (plan, ask, auto)
        model: Model alias (sonnet, opus, haiku)
        allowed_tools: List of allowed tool names
        denied_tools: List of denied tool names
        max_turns: Maximum number of turns
        thinking_budget: Extended thinking token budget
        images: Optional list of image attachments with base64_data
        on_config_change: Optional callback for config changes (model, mode, etc.)
        cli_session_id: Claude Code session ID to resume (for conversation continuity)
        session_id: Session ID for WebSocket events (permission requests)
        agent_id: Agent ID for WebSocket events (permission requests)

    Returns:
        Dict with response content, tool calls, and metadata (includes cli_session_id)
    """
    # Check if this is a built-in CLI command (like /status, /cost, etc.)
    is_builtin, cmd_name, cmd_args = is_builtin_cli_command(message)
    if is_builtin:
        return await _execute_builtin_command(
            workspace_id, user_id, cmd_name, cmd_args, cli_session_id
        )

    # Save images to workspace temp files if present
    image_paths: list[str] = []
    if images:
        for img in images:
            if img.get("base64_data"):
                # Extract base64 data (remove data:image/xxx;base64, prefix if present)
                data = img["base64_data"]
                if data.startswith("data:"):
                    data = data.split(",", 1)[1] if "," in data else data

                # Generate temp filename
                ext = img.get("media_type", "image/png").split("/")[-1]
                temp_name = f"/tmp/attachment_{uuid.uuid4().hex[:8]}.{ext}"  # noqa: S108

                # Write image to workspace via base64 decode
                try:
                    # Use echo with base64 decode to write file
                    await workspace_router.exec_command(
                        workspace_id=workspace_id,
                        user_id=user_id,
                        command=f"echo '{data}' | base64 -d > {temp_name}",
                        exec_timeout=10,
                    )
                    image_paths.append(temp_name)
                except Exception as e:
                    logger.warning(
                        "Failed to save image attachment",
                        workspace_id=workspace_id,
                        error=str(e),
                    )

    # Build command
    escaped_message = shlex.quote(message)

    # Use PATH prefix to find claude in user's npm-global directory
    # Note: Use absolute path /home/dev instead of ~ because exec runs as root
    # Note: --verbose is required when using -p with --output-format stream-json
    # Note: model should be a simple alias like 'sonnet', 'opus', 'haiku'
    parts = [
        "PATH=/home/dev/.npm-global/bin:$PATH",
        "claude",
        "-p",
        escaped_message,
        "--output-format",
        "stream-json",
        "--verbose",
        "--max-turns",
        str(max_turns),
        "--model",
        model,
    ]

    if mode == "plan":
        parts.append("--plan")
    elif mode == "sovereign":
        # Only sovereign mode skips ALL permission prompts for full autonomy
        parts.append("--dangerously-skip-permissions")
    elif mode == "auto":
        # Auto mode: auto-approve file edits but still prompt for commands
        # Use acceptEdits permission mode if supported
        parts.append("--permission-mode=acceptEdits")

    if allowed_tools:
        # Quote to escape special characters like parentheses in tool patterns
        parts.extend(["--allowedTools", shlex.quote(",".join(allowed_tools))])

    if denied_tools:
        parts.extend(["--disallowedTools", shlex.quote(",".join(denied_tools))])

    # Note: thinking_budget is not supported as a CLI flag
    # Extended thinking is controlled through the API/model, not via CLI flags

    # Resume existing conversation for context continuity
    if cli_session_id:
        parts.extend(["--resume", cli_session_id])

    # Add image files if present (Claude Code supports --add-file for images)
    for img_path in image_paths:
        parts.extend(["--add-file", img_path])

    cmd = " ".join(parts)

    logger.info(
        "Executing Claude Code command",
        workspace_id=workspace_id,
        mode=mode,
        model=model,
        command_preview=cmd[:200],
    )

    # Execute the command
    try:
        result = await workspace_router.exec_command(
            workspace_id=workspace_id,
            user_id=user_id,
            command=cmd,
            exec_timeout=300,  # 5 minute timeout for long operations
        )

        stdout = result.get("stdout", "")
        stderr = result.get("stderr", "")
        exit_code = result.get("exit_code", 0)

        logger.info(
            "Claude CLI raw output",
            workspace_id=workspace_id,
            exit_code=exit_code,
            stdout_length=len(stdout),
            stderr_length=len(stderr),
            stdout_preview=stdout[:500] if stdout else "(empty)",
            stderr_preview=stderr[:500] if stderr else "(empty)",
        )

        # Parse stream-json output
        content = ""
        thinking = ""
        tool_calls = []
        captured_session_id: str | None = None  # Capture session ID for continuity
        # Token usage tracking for context indicator
        input_tokens = 0
        output_tokens = 0

        for line in stdout.strip().split("\n"):
            if not line.strip():
                continue

            try:
                parsed = json.loads(line)

                # Handle both JSON array and single object formats
                events_to_process = parsed if isinstance(parsed, list) else [parsed]

                for event in events_to_process:
                    event_type = event.get("type", "")

                    # Log all event types for debugging
                    # (INFO for user events to debug permission detection)
                    if event_type == "user":
                        logger.info(
                            "CLI user event received",
                            event_type=event_type,
                            event_keys=list(event.keys()),
                            event_preview=str(event)[:300],
                            session_id=session_id,
                            agent_id=agent_id,
                        )
                    else:
                        logger.debug(
                            "CLI event",
                            event_type=event_type,
                            event_keys=list(event.keys()),
                            event_preview=str(event)[:200],
                        )

                    if event_type == "thinking":
                        thinking += event.get("thinking", "")
                    elif event_type == "text":
                        content += event.get("text", "")
                    elif event_type == "assistant":
                        # Some CLI versions use "assistant" type with "message" content
                        if "message" in event:
                            message = event.get("message", "")
                            if isinstance(message, str):
                                content += message
                            elif isinstance(message, dict):
                                # Extract content from message object
                                msg_content = message.get("content", [])
                                if isinstance(msg_content, str):
                                    content += msg_content
                                elif isinstance(msg_content, list):
                                    for block in msg_content:
                                        if isinstance(block, dict):
                                            if block.get("type") == "text":
                                                content += block.get("text", "")
                                            elif block.get("type") == "tool_use":
                                                # Capture tool_use from assistant message
                                                tool_calls.append(
                                                    {
                                                        "id": block.get("id"),
                                                        "name": block.get("name"),
                                                        "args": block.get("input"),
                                                        "status": "pending",
                                                    }
                                                )
                                        elif isinstance(block, str):
                                            content += block
                        elif "content" in event:
                            event_content = event.get("content", "")
                            if isinstance(event_content, str):
                                content += event_content
                            elif isinstance(event_content, list):
                                for block in event_content:
                                    if isinstance(block, dict) and block.get("type") == "text":
                                        content += block.get("text", "")
                                    elif isinstance(block, str):
                                        content += block
                    elif event_type == "content_block_delta":
                        # Handle streaming delta events
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            content += delta.get("text", "")
                    elif event_type == "result":
                        # Final result event - only use if we haven't captured content yet
                        # The 'result' field duplicates content from 'assistant' events
                        if not content and "result" in event:
                            content += str(event.get("result", ""))
                    elif event_type == "tool_use":
                        tool_calls.append(
                            {
                                "id": event.get("id"),
                                "name": event.get("name"),
                                "args": event.get("input"),
                                "status": "pending",
                            }
                        )
                    elif event_type == "tool_result":
                        tool_id = event.get("tool_use_id")
                        result_content = event.get("content", "")
                        is_error = event.get("is_error", False)

                        for tc in tool_calls:
                            if tc["id"] == tool_id:
                                tc["status"] = "error" if is_error else "completed"
                                tc["result"] = result_content

                                # Detect permission denial and emit permission_request
                                if session_id and agent_id:
                                    result_str = str(result_content).lower()
                                    if (
                                        "requires approval" in result_str
                                        or "was blocked" in result_str
                                        or "requested permissions" in result_str
                                        or "haven't granted" in result_str
                                    ):
                                        # Extract command from the tool args
                                        command = None
                                        tool_name = tc.get("name", "Bash")
                                        if tc.get("args"):
                                            command = tc["args"].get("command") or tc["args"].get(
                                                "input"
                                            )

                                        logger.info(
                                            "Permission denial detected from tool_result",
                                            session_id=session_id,
                                            agent_id=agent_id,
                                            tool_id=tool_id,
                                            tool_name=tool_name,
                                            command=command[:100] if command else None,
                                        )

                                        # Store context for auto-retry after approval
                                        store_pending_permission_context(
                                            request_id=str(tool_id or ""),
                                            session_id=session_id,
                                            agent_id=agent_id,
                                            workspace_id=workspace_id,
                                            user_id=user_id,
                                            message=message,
                                            mode=mode,
                                            model=model,
                                            command=command,
                                            tool_name=tool_name,
                                            allowed_tools=allowed_tools,
                                            cli_session_id=cli_session_id,
                                            thinking_budget=thinking_budget,
                                        )

                                        await emit_permission_request(
                                            session_id=session_id,
                                            agent_id=agent_id,
                                            request_id=str(tool_id or ""),
                                            command=command,
                                            description=result_content,
                                            tool_name=tool_name,
                                        )
                                break
                    elif event_type == "user":
                        # Handle user events which contain tool_result in nested content
                        logger.info(
                            "ENTERED user event handler",
                            session_id=session_id,
                            agent_id=agent_id,
                            has_message="message" in event,
                        )
                        msg = event.get("message", {})
                        msg_content = msg.get("content", [])
                        logger.info(
                            "User event message content",
                            msg_content_type=type(msg_content).__name__,
                            msg_content_len=len(msg_content)
                            if isinstance(msg_content, list)
                            else 0,
                            msg_content_preview=str(msg_content)[:300],
                        )
                        if isinstance(msg_content, list):
                            for block in msg_content:
                                if isinstance(block, dict) and block.get("type") == "tool_result":
                                    tool_id = block.get("tool_use_id")
                                    result_content = block.get("content", "")
                                    is_error = block.get("is_error", False)

                                    logger.info(
                                        "Found tool_result in user event",
                                        tool_id=tool_id,
                                        is_error=is_error,
                                        result_content_preview=str(result_content)[:300],
                                    )

                                    # Update matching tool_call if found
                                    for tc in tool_calls:
                                        if tc["id"] == tool_id:
                                            tc["status"] = "error" if is_error else "completed"
                                            tc["result"] = result_content
                                            break

                                    # Detect permission denial OUTSIDE of tool_calls loop
                                    # This ensures detection even if no matching tool_call exists
                                    logger.info(
                                        "Checking permission denial patterns",
                                        session_id=session_id,
                                        agent_id=agent_id,
                                        has_session_and_agent=bool(session_id and agent_id),
                                    )
                                    if session_id and agent_id:
                                        result_str = str(result_content).lower()
                                        has_requires_approval = "requires approval" in result_str
                                        has_was_blocked = "was blocked" in result_str
                                        has_requested_permissions = (
                                            "requested permissions" in result_str
                                        )
                                        has_havent_granted = "haven't granted" in result_str

                                        logger.info(
                                            "Permission pattern check results",
                                            has_requires_approval=has_requires_approval,
                                            has_was_blocked=has_was_blocked,
                                            has_requested_permissions=has_requested_permissions,
                                            has_havent_granted=has_havent_granted,
                                            result_str_preview=result_str[:300],
                                        )

                                        if (
                                            has_requires_approval
                                            or has_was_blocked
                                            or has_requested_permissions
                                            or has_havent_granted
                                        ):
                                            # Try to find matching tool_call for command info
                                            command = None
                                            tool_name = "Write"  # Default for file operations
                                            for tc in tool_calls:
                                                if tc["id"] == tool_id:
                                                    tool_name = tc.get("name", "Write")
                                                    if tc.get("args"):
                                                        command = (
                                                            tc["args"].get("command")
                                                            or tc["args"].get("input")
                                                            or tc["args"].get("file_path")
                                                        )
                                                    break

                                            # Extract file path if no command found
                                            if not command and "write to" in result_str:
                                                # Extract path from result
                                                match = re.search(r"write to ([^\s,]+)", result_str)
                                                if match:
                                                    command = match.group(1)

                                            logger.info(
                                                "Permission denial detected from user event",
                                                session_id=session_id,
                                                agent_id=agent_id,
                                                tool_id=tool_id,
                                                tool_name=tool_name,
                                                command=command[:100] if command else None,
                                            )

                                            # Store context for auto-retry
                                            store_pending_permission_context(
                                                request_id=str(tool_id or ""),
                                                session_id=session_id,
                                                agent_id=agent_id,
                                                workspace_id=workspace_id,
                                                user_id=user_id,
                                                message=message,
                                                mode=mode,
                                                model=model,
                                                command=command,
                                                tool_name=tool_name,
                                                allowed_tools=allowed_tools,
                                                cli_session_id=cli_session_id,
                                                thinking_budget=thinking_budget,
                                            )

                                            await emit_permission_request(
                                                session_id=session_id,
                                                agent_id=agent_id,
                                                request_id=str(tool_id or ""),
                                                command=command,
                                                description=result_content,
                                                tool_name=tool_name,
                                            )
                                            break
                    elif event_type == "error":
                        error_msg = event.get("error", {}).get("message", "Unknown error")
                        content += f"\n\n❌ Error: {error_msg}"
                    elif event_type == "permission_request":
                        # Claude CLI is requesting permission
                        # Emit via websocket if we have session info
                        if session_id and agent_id:
                            request_id = (
                                event.get("id") or event.get("request_id") or str(uuid.uuid4())
                            )
                            command = event.get("command") or event.get("prompt")
                            tool_name = event.get("tool_name") or event.get("tool") or "Bash"
                            description = event.get("description") or event.get("message")

                            logger.info(
                                "Permission request from Claude CLI (non-streaming)",
                                session_id=session_id,
                                agent_id=agent_id,
                                request_id=request_id,
                                command=command[:100] if command else None,
                                tool_name=tool_name,
                            )

                            await emit_permission_request(
                                session_id=session_id,
                                agent_id=agent_id,
                                request_id=request_id,
                                command=command,
                                description=description,
                                tool_name=tool_name,
                            )
                    elif event_type in ("system", "init", "config", "config_change"):
                        # Capture session ID for conversation continuity
                        if "session_id" in event:
                            captured_session_id = event["session_id"]
                            logger.debug(
                                "Captured Claude CLI session ID",
                                cli_session_id=captured_session_id,
                            )
                        # Handle config changes (model, mode, etc.)
                        if on_config_change:
                            config_updates = {}
                            if "model" in event:
                                config_updates["model"] = event["model"]
                            if "mode" in event:
                                config_updates["mode"] = event["mode"]
                            if config_updates:
                                await on_config_change(config_updates)

                    elif event_type == "usage":
                        # Token usage event from Claude Code CLI
                        input_tokens = event.get("input_tokens", input_tokens)
                        output_tokens = event.get("output_tokens", output_tokens)

                    elif event_type == "result":
                        # Result event may contain final usage stats
                        usage = event.get("usage", {})
                        if usage:
                            input_tokens = usage.get("input_tokens", input_tokens)
                            output_tokens = usage.get("output_tokens", output_tokens)

                    # Check for usage in any event (Anthropic API format)
                    if "usage" in event:
                        usage_data = event["usage"]
                        if isinstance(usage_data, dict):
                            input_tokens = usage_data.get("input_tokens", input_tokens)
                            output_tokens = usage_data.get("output_tokens", output_tokens)

            except json.JSONDecodeError:
                # Non-JSON output - append to content
                logger.debug("Non-JSON line from CLI", line_preview=line[:100])
                content += line + "\n"

        # Calculate total tokens used for context tracking
        tokens_used = input_tokens + output_tokens

        logger.info(
            "Claude CLI parsed output",
            workspace_id=workspace_id,
            content_length=len(content.strip()),
            content_preview=content.strip()[:200] if content.strip() else "(empty)",
            has_thinking=bool(thinking),
            tool_calls_count=len(tool_calls),
            cli_session_id=captured_session_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            tokens_used=tokens_used,
        )

        return {
            "content": content.strip(),
            "thinking": thinking if thinking else None,
            "tool_calls": tool_calls if tool_calls else None,
            "exit_code": exit_code,
            "success": exit_code == 0,
            "cli_session_id": captured_session_id,  # For conversation continuity
            "tokens_used": tokens_used,  # For context tracking
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    except Exception as e:
        logger.exception(
            "Claude Code execution failed",
            workspace_id=workspace_id,
            error=str(e),
        )
        return {
            "content": f"❌ Execution failed: {e}",
            "thinking": None,
            "tool_calls": None,
            "exit_code": 1,
            "success": False,
            "cli_session_id": None,
            "tokens_used": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }


async def execute_claude_code_message_streaming(
    workspace_id: str,
    user_id: str,
    message: str,
    session_id: str,
    agent_id: str,
    message_id: str,
    mode: str = "ask",
    model: str = "sonnet",
    allowed_tools: list[str] | None = None,
    denied_tools: list[str] | None = None,
    max_turns: int = 50,
    thinking_budget: int | None = None,
    images: list[dict[str, Any]] | None = None,
    on_config_change: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    cli_session_id: str | None = None,
) -> dict[str, Any]:
    """Execute a message using Claude Code CLI with real-time streaming.

    Streams thinking and content tokens in real-time via websocket events.

    Args:
        workspace_id: The workspace where Claude CLI is available
        user_id: User ID for authorization
        message: The user message to send to Claude Code
        session_id: Session ID for streaming events
        agent_id: Agent ID for streaming events
        message_id: Message ID for streaming events
        mode: Operation mode (plan, ask, auto)
        model: Model alias (sonnet, opus, haiku)
        allowed_tools: List of allowed tool names
        denied_tools: List of denied tool names
        max_turns: Maximum number of turns
        thinking_budget: Extended thinking token budget
        images: Optional list of image attachments with base64_data
        on_config_change: Optional callback for config changes (model, mode, etc.)
        cli_session_id: Claude Code session ID to resume (for conversation continuity)

    Returns:
        Dict with response content, tool calls, and metadata (includes cli_session_id)
    """
    # Check if this is a built-in CLI command (like /status, /cost, etc.)
    is_builtin, cmd_name, cmd_args = is_builtin_cli_command(message)
    if is_builtin:
        # Built-in commands don't need streaming - execute directly
        result = await _execute_builtin_command(
            workspace_id, user_id, cmd_name, cmd_args, cli_session_id
        )
        # Emit the content as a single token for display
        if result.get("content"):
            await emit_agent_token(
                session_id=session_id,
                agent_id=agent_id,
                token=result["content"],
                message_id=message_id,
            )
        return result

    # Save images to workspace temp files if present
    image_paths: list[str] = []
    if images:
        for img in images:
            if img.get("base64_data"):
                data = img["base64_data"]
                if data.startswith("data:"):
                    data = data.split(",", 1)[1] if "," in data else data

                ext = img.get("media_type", "image/png").split("/")[-1]
                temp_name = f"/tmp/attachment_{uuid.uuid4().hex[:8]}.{ext}"  # noqa: S108

                try:
                    await workspace_router.exec_command(
                        workspace_id=workspace_id,
                        user_id=user_id,
                        command=f"echo '{data}' | base64 -d > {temp_name}",
                        exec_timeout=10,
                    )
                    image_paths.append(temp_name)
                except Exception as e:
                    logger.warning(
                        "Failed to save image attachment",
                        workspace_id=workspace_id,
                        error=str(e),
                    )

    # Build command
    escaped_message = shlex.quote(message)

    parts = [
        "PATH=/home/dev/.npm-global/bin:$PATH",
        "claude",
        "-p",
        escaped_message,
        "--output-format",
        "stream-json",
        "--verbose",
        "--max-turns",
        str(max_turns),
        "--model",
        model,
    ]

    if mode == "plan":
        parts.append("--plan")
    elif mode == "sovereign":
        # Only sovereign mode skips ALL permission prompts for full autonomy
        parts.append("--dangerously-skip-permissions")
    elif mode == "auto":
        # Auto mode: auto-approve file edits but still prompt for commands
        # Use acceptEdits permission mode if supported
        parts.append("--permission-mode=acceptEdits")

    if allowed_tools:
        # Quote to escape special characters like parentheses in tool patterns
        parts.extend(["--allowedTools", shlex.quote(",".join(allowed_tools))])

    if denied_tools:
        parts.extend(["--disallowedTools", shlex.quote(",".join(denied_tools))])

    # Note: thinking_budget is not supported as a CLI flag
    # Extended thinking is controlled through the API/model, not via CLI flags

    # Resume existing conversation for context continuity
    if cli_session_id:
        parts.extend(["--resume", cli_session_id])

    for img_path in image_paths:
        parts.extend(["--add-file", img_path])

    cmd = " ".join(parts)

    logger.info(
        "Executing Claude Code command (streaming)",
        workspace_id=workspace_id,
        mode=mode,
        model=model,
        command_preview=cmd[:200],
    )

    # Execute with streaming
    try:
        content = ""
        thinking = ""
        tool_calls: list[dict[str, Any]] = []
        exit_code = 0
        captured_session_id: str | None = None  # Capture CLI session for conversation continuity
        # Token usage tracking for context indicator
        input_tokens = 0
        output_tokens = 0
        # Buffer for incomplete lines (streaming chunks may split mid-JSON)
        line_buffer = ""

        async for chunk in workspace_router.exec_command_stream(
            workspace_id=workspace_id,
            user_id=user_id,
            command=cmd,
            exec_timeout=300,
        ):
            # Accumulate chunk into buffer
            line_buffer += chunk

            # Process complete lines - SSE uses null byte (\x00) as line separator
            # to avoid conflicting with JSON's \n escape sequences in text content
            while "\x00" in line_buffer:
                line, line_buffer = line_buffer.split("\x00", 1)
                if not line.strip():
                    continue

                try:
                    parsed = json.loads(line)

                    # Handle both JSON array and single object formats
                    events_to_process = parsed if isinstance(parsed, list) else [parsed]

                    for event in events_to_process:
                        event_type = event.get("type", "")

                        logger.debug(
                            "CLI streaming event",
                            event_type=event_type,
                            event_preview=str(event)[:200],
                        )

                        if event_type == "thinking":
                            thinking_text = event.get("thinking", "")
                            thinking += thinking_text
                            if thinking_text:
                                await emit_agent_thinking_token(
                                    session_id=session_id,
                                    agent_id=agent_id,
                                    thinking=thinking_text,
                                    message_id=message_id,
                                )

                        elif event_type == "text":
                            text = event.get("text", "")
                            content += text
                            if text:
                                await emit_agent_token(
                                    session_id=session_id,
                                    agent_id=agent_id,
                                    token=text,
                                    message_id=message_id,
                                )

                        elif event_type == "assistant":
                            # Handle assistant message content
                            if "message" in event:
                                msg = event.get("message", "")
                                if isinstance(msg, dict):
                                    msg_content = msg.get("content", [])
                                    if isinstance(msg_content, list):
                                        for block in msg_content:
                                            if isinstance(block, dict):
                                                if block.get("type") == "text":
                                                    text = block.get("text", "")
                                                    content += text
                                                    if text:
                                                        await emit_agent_token(
                                                            session_id=session_id,
                                                            agent_id=agent_id,
                                                            token=text,
                                                            message_id=message_id,
                                                        )
                                                elif block.get("type") == "thinking":
                                                    thinking_text = block.get("thinking", "")
                                                    thinking += thinking_text
                                                    if thinking_text:
                                                        await emit_agent_thinking_token(
                                                            session_id=session_id,
                                                            agent_id=agent_id,
                                                            thinking=thinking_text,
                                                            message_id=message_id,
                                                        )
                                                elif block.get("type") == "tool_use":
                                                    # Capture tool_use from assistant message
                                                    tool_calls.append(
                                                        {
                                                            "id": block.get("id"),
                                                            "name": block.get("name"),
                                                            "args": block.get("input"),
                                                            "status": "pending",
                                                        }
                                                    )

                        elif event_type == "user":
                            # Handle user events with tool_result in nested content
                            msg = event.get("message", {})
                            msg_content = msg.get("content", [])
                            if isinstance(msg_content, list):
                                for block in msg_content:
                                    if (
                                        isinstance(block, dict)
                                        and block.get("type") == "tool_result"
                                    ):
                                        tool_id = block.get("tool_use_id")
                                        result_content = block.get("content", "")
                                        is_error = block.get("is_error", False)

                                        # Update matching tool_call if found
                                        for tc in tool_calls:
                                            if tc["id"] == tool_id:
                                                tc["status"] = "error" if is_error else "completed"
                                                tc["result"] = result_content
                                                break

                                        # Detect permission denial OUTSIDE of tool_calls loop
                                        if session_id and agent_id:
                                            result_str = str(result_content).lower()
                                            if (
                                                "requires approval" in result_str
                                                or "was blocked" in result_str
                                                or "requested permissions" in result_str
                                                or "haven't granted" in result_str
                                            ):
                                                # Try to find matching tool_call for command info
                                                command = None
                                                tool_name = "Write"  # Default for file operations
                                                for tc in tool_calls:
                                                    if tc["id"] == tool_id:
                                                        tool_name = tc.get("name", "Write")
                                                        if tc.get("args"):
                                                            command = (
                                                                tc["args"].get("command")
                                                                or tc["args"].get("input")
                                                                or tc["args"].get("file_path")
                                                            )
                                                        break

                                                # Extract file path if no command found
                                                if not command and "write to" in result_str:
                                                    match = re.search(
                                                        r"write to ([^\s,]+)", result_str
                                                    )
                                                    if match:
                                                        command = match.group(1)

                                                logger.info(
                                                    "Permission denial detected from "
                                                    "user event (streaming)",
                                                    session_id=session_id,
                                                    agent_id=agent_id,
                                                    tool_id=tool_id,
                                                    tool_name=tool_name,
                                                    command=command[:100] if command else None,
                                                )

                                                # Store context for auto-retry
                                                store_pending_permission_context(
                                                    request_id=str(tool_id or ""),
                                                    session_id=session_id,
                                                    agent_id=agent_id,
                                                    workspace_id=workspace_id,
                                                    user_id=user_id,
                                                    message=message,
                                                    mode=mode,
                                                    model=model,
                                                    command=command,
                                                    tool_name=tool_name,
                                                    allowed_tools=allowed_tools,
                                                    cli_session_id=cli_session_id,
                                                    thinking_budget=thinking_budget,
                                                )

                                                await emit_permission_request(
                                                    session_id=session_id,
                                                    agent_id=agent_id,
                                                    request_id=str(tool_id or ""),
                                                    command=command,
                                                    description=result_content,
                                                    tool_name=tool_name,
                                                )
                                                break

                        elif event_type == "content_block_delta":
                            delta = event.get("delta", {})
                            if delta.get("type") == "text_delta":
                                text = delta.get("text", "")
                                content += text
                                if text:
                                    await emit_agent_token(
                                        session_id=session_id,
                                        agent_id=agent_id,
                                        token=text,
                                        message_id=message_id,
                                    )
                            elif delta.get("type") == "thinking_delta":
                                thinking_text = delta.get("thinking", "")
                                thinking += thinking_text
                                if thinking_text:
                                    await emit_agent_thinking_token(
                                        session_id=session_id,
                                        agent_id=agent_id,
                                        thinking=thinking_text,
                                        message_id=message_id,
                                    )

                        elif event_type == "result":
                            # Final result - only use if we haven't captured content yet
                            if not content and "result" in event:
                                result_text = str(event.get("result", ""))
                                content += result_text
                                if result_text:
                                    await emit_agent_token(
                                        session_id=session_id,
                                        agent_id=agent_id,
                                        token=result_text,
                                        message_id=message_id,
                                    )

                        elif event_type == "tool_use":
                            tool_calls.append(
                                {
                                    "id": event.get("id"),
                                    "name": event.get("name"),
                                    "args": event.get("input"),
                                    "status": "pending",
                                }
                            )

                        elif event_type == "tool_result":
                            tool_id = event.get("tool_use_id")
                            result_content = event.get("content", "")
                            is_error = event.get("is_error", False)

                            for tc in tool_calls:
                                if tc["id"] == tool_id:
                                    tc["status"] = "error" if is_error else "completed"
                                    tc["result"] = result_content

                                    # Detect permission denial and emit permission_request
                                    if session_id and agent_id:
                                        result_str = str(result_content).lower()
                                        if (
                                            "requires approval" in result_str
                                            or "was blocked" in result_str
                                            or "requested permissions" in result_str
                                            or "haven't granted" in result_str
                                        ):
                                            # Extract command from the tool args
                                            command = None
                                            tool_name = tc.get("name", "Bash")
                                            if tc.get("args"):
                                                command = tc["args"].get("command") or tc[
                                                    "args"
                                                ].get("input")

                                            logger.info(
                                                "Permission denial detected from "
                                                "tool_result (streaming)",
                                                session_id=session_id,
                                                agent_id=agent_id,
                                                tool_id=tool_id,
                                                tool_name=tool_name,
                                                command=command[:100] if command else None,
                                            )

                                            # Store context for auto-retry
                                            store_pending_permission_context(
                                                request_id=str(tool_id or ""),
                                                session_id=session_id,
                                                agent_id=agent_id,
                                                workspace_id=workspace_id,
                                                user_id=user_id,
                                                message=message,
                                                mode=mode,
                                                model=model,
                                                command=command,
                                                tool_name=tool_name,
                                                allowed_tools=allowed_tools,
                                                cli_session_id=cli_session_id,
                                                thinking_budget=thinking_budget,
                                            )

                                            await emit_permission_request(
                                                session_id=session_id,
                                                agent_id=agent_id,
                                                request_id=str(tool_id or ""),
                                                command=command,
                                                description=result_content,
                                                tool_name=tool_name,
                                            )
                                    break

                        elif event_type == "error":
                            error_msg = event.get("error", {}).get("message", "Unknown error")
                            error_text = f"\n\n❌ Error: {error_msg}"
                            content += error_text
                            await emit_agent_token(
                                session_id=session_id,
                                agent_id=agent_id,
                                token=error_text,
                                message_id=message_id,
                            )

                        elif event_type == "permission_request":
                            # Claude CLI is requesting permission to execute
                            # a command/tool. Emit permission request to frontend
                            # for user approval
                            request_id = (
                                event.get("id") or event.get("request_id") or str(uuid.uuid4())
                            )
                            command = event.get("command") or event.get("prompt")
                            tool_name = event.get("tool_name") or event.get("tool") or "Bash"
                            description = event.get("description") or event.get("message")

                            logger.info(
                                "Permission request from Claude CLI",
                                session_id=session_id,
                                agent_id=agent_id,
                                request_id=request_id,
                                command=command[:100] if command else None,
                                tool_name=tool_name,
                            )

                            await emit_permission_request(
                                session_id=session_id,
                                agent_id=agent_id,
                                request_id=request_id,
                                command=command,
                                description=description,
                                tool_name=tool_name,
                            )

                        elif event_type == "system":
                            # Handle init event - capture session ID for conversation continuity
                            if event.get("subtype") == "init":
                                # Capture the CLI session ID for resuming conversations
                                if "session_id" in event:
                                    captured_session_id = event["session_id"]
                                    logger.debug(
                                        "Captured Claude CLI session ID",
                                        cli_session_id=captured_session_id,
                                    )
                                elif "sessionId" in event:
                                    captured_session_id = event["sessionId"]
                                    logger.debug(
                                        "Captured Claude CLI session ID (camelCase)",
                                        cli_session_id=captured_session_id,
                                    )
                                # Handle config changes
                                if on_config_change:
                                    config_changes = {}
                                    if "model" in event:
                                        config_changes["model"] = event["model"]
                                    if config_changes:
                                        await on_config_change(config_changes)

                        elif event_type == "usage":
                            # Token usage event from Claude Code CLI
                            input_tokens = event.get("input_tokens", input_tokens)
                            output_tokens = event.get("output_tokens", output_tokens)
                            logger.debug(
                                "Usage event received",
                                input_tokens=input_tokens,
                                output_tokens=output_tokens,
                            )

                        elif event_type == "result":
                            # Result event may contain final usage stats
                            usage = event.get("usage", {})
                            if usage:
                                input_tokens = usage.get("input_tokens", input_tokens)
                                output_tokens = usage.get("output_tokens", output_tokens)
                            # Also check for cost_usd which indicates usage tracking is present
                            if "total_cost_usd" in event:
                                logger.debug(
                                    "Result with usage",
                                    input_tokens=input_tokens,
                                    output_tokens=output_tokens,
                                    cost_usd=event.get("total_cost_usd"),
                                )

                        # Check for usage in message_stop events (Anthropic API format)
                        if "usage" in event:
                            usage_data = event["usage"]
                            if isinstance(usage_data, dict):
                                input_tokens = usage_data.get("input_tokens", input_tokens)
                                output_tokens = usage_data.get("output_tokens", output_tokens)

                except json.JSONDecodeError:
                    # Non-JSON output - log for debugging but don't treat as error
                    # (may be partial line that will complete with next chunk)
                    logger.debug(
                        "Skipping non-JSON CLI output line",
                        line=line[:200],
                    )

        # Process any remaining content in the buffer after stream ends
        # Buffer may contain multiple JSON lines or a single incomplete line
        for remaining_line in line_buffer.split("\x00"):
            if not remaining_line.strip():
                continue
            try:
                parsed = json.loads(remaining_line)
                events_to_process = parsed if isinstance(parsed, list) else [parsed]
                for event in events_to_process:
                    event_type = event.get("type", "")
                    logger.debug(
                        "CLI final buffer event",
                        event_type=event_type,
                        event_preview=str(event)[:200],
                    )
                    # Handle result event from final buffer
                    if event_type == "result":
                        if not content and "result" in event:
                            result_text = str(event.get("result", ""))
                            content += result_text
                            if result_text:
                                await emit_agent_token(
                                    session_id=session_id,
                                    agent_id=agent_id,
                                    token=result_text,
                                    message_id=message_id,
                                )
                        # Also extract usage from result
                        usage = event.get("usage", {})
                        if usage:
                            input_tokens = usage.get("input_tokens", input_tokens)
                            output_tokens = usage.get("output_tokens", output_tokens)
            except json.JSONDecodeError:
                logger.debug(
                    "Non-JSON content in final buffer line",
                    line=remaining_line[:200],
                )

        # Calculate total tokens used for context tracking
        tokens_used = input_tokens + output_tokens

        logger.info(
            "Claude CLI streaming completed",
            workspace_id=workspace_id,
            content_length=len(content.strip()),
            content_preview=content.strip()[:200] if content.strip() else "(empty)",
            has_thinking=bool(thinking),
            tool_calls_count=len(tool_calls),
            cli_session_id=captured_session_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            tokens_used=tokens_used,
        )

        return {
            "content": content.strip(),
            "thinking": thinking if thinking else None,
            "tool_calls": tool_calls if tool_calls else None,
            "exit_code": exit_code,
            "success": exit_code == 0,
            "cli_session_id": captured_session_id,  # For conversation continuity
            "tokens_used": tokens_used,  # For context tracking
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    except Exception as e:
        logger.exception(
            "Claude Code streaming execution failed",
            workspace_id=workspace_id,
            error=str(e),
        )
        return {
            "content": f"❌ Execution failed: {e}",
            "thinking": None,
            "tool_calls": None,
            "exit_code": 1,
            "success": False,
            "tokens_used": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }


# ==================== Claude Code Installation Check ====================


@router.get("/agents/{agent_id}/check-installation")
async def check_claude_installation(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, Any]:
    """Check if Claude Code CLI is installed in the workspace."""
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    await verify_session_access(session.id, request, db)

    if not session.workspace_id:
        return {
            "installed": False,
            "version": None,
            "error": "No workspace associated with session",
        }

    try:
        # Check if claude is installed and get version
        result = await workspace_router.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="claude --version 2>/dev/null || echo 'not_installed'",
            exec_timeout=10,
        )
        stdout = result.get("stdout", "").strip()
    except Exception as e:
        logger.warning(
            "Failed to check Claude installation",
            agent_id=agent_id,
            error=str(e),
        )
        return {
            "installed": False,
            "version": None,
            "error": str(e),
        }
    else:
        if "not_installed" in stdout:
            return {
                "installed": False,
                "version": None,
            }

        return {
            "installed": True,
            "version": stdout,
        }


@router.post("/agents/{agent_id}/install")
async def install_claude_cli(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, Any]:
    """Install Claude Code CLI in the workspace."""
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    await verify_session_access(session.id, request, db)

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="No workspace associated with session")

    try:
        # Install Claude Code CLI via npm
        result = await workspace_router.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="npm install -g @anthropic-ai/claude-code",
            exec_timeout=120,  # 2 minute timeout for installation
        )

        exit_code = result.get("exit_code", 1)
        stdout = result.get("stdout", "")
        stderr = result.get("stderr", "")

        if exit_code != 0:
            return {
                "success": False,
                "error": stderr or stdout or "Installation failed",
            }

        # Verify installation
        verify_result = await workspace_router.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="claude --version",
            exec_timeout=10,
        )
        version = verify_result.get("stdout", "").strip()
    except Exception as e:
        logger.exception(
            "Failed to install Claude CLI",
            agent_id=agent_id,
            error=str(e),
        )
        return {
            "success": False,
            "error": str(e),
        }
    else:
        logger.info(
            "Claude Code CLI installed",
            agent_id=agent_id,
            version=version,
        )

        return {
            "success": True,
            "version": version,
        }
