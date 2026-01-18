"""Claude Code API routes for native Claude Code integration.

These routes handle Claude Code-specific functionality like:
- Checking/managing authentication status
- Running slash commands
- Managing custom commands
- Re-authentication flow
"""

from __future__ import annotations

import json
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

from src.compute_client import compute_client
from src.database import Agent as AgentModel
from src.database import Session as SessionModel
from src.routes.dependencies import DbSession, get_current_user_id, verify_session_access

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
]


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

    # Check if credentials file exists in workspace
    try:
        result = await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="test -f ~/.claude/credentials.json && echo 'exists'",
            exec_timeout=10,
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

    # Remove credentials file
    try:
        await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="rm -f ~/.claude/credentials.json",
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

    Returns both built-in Claude Code commands and user-defined custom commands.
    """
    # For now, just return built-in commands
    # TODO: Add user's custom commands from database
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

    # Build the command
    cmd = f"/{data.command}"
    if data.args:
        cmd += f" {data.args}"

    # Execute via Claude CLI
    try:
        result = await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command=f"claude -p '{cmd}' --output-format json 2>&1",
            exec_timeout=30,
        )

        stdout = result.get("stdout", "")
        stderr = result.get("stderr", "")
        exit_code = result.get("exit_code", 0)

        if exit_code != 0:
            return ExecuteCommandResponse(
                success=False,
                error=stderr or stdout or "Command failed",
            )

        return ExecuteCommandResponse(
            success=True,
            output=stdout,
        )

    except Exception as e:
        logger.exception(
            "Failed to execute slash command",
            agent_id=agent_id,
            command=data.command,
            error=str(e),
        )
        return ExecuteCommandResponse(
            success=False,
            error=str(e),
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

    Returns:
        Dict with response content, tool calls, and metadata
    """
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
                    await compute_client.exec_command(
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
        "claude",
        "-p",
        escaped_message,
        "--output-format",
        "stream-json",
        "--max-turns",
        str(max_turns),
        "--model",
        model,
    ]

    if mode == "plan":
        parts.append("--plan")

    if allowed_tools:
        parts.extend(["--allowedTools", ",".join(allowed_tools)])

    if denied_tools:
        parts.extend(["--disallowedTools", ",".join(denied_tools)])

    if thinking_budget:
        parts.extend(["--thinking-budget", str(thinking_budget)])

    # Add image files if present (Claude Code supports --add-file for images)
    for img_path in image_paths:
        parts.extend(["--add-file", img_path])

    cmd = " ".join(parts)

    logger.info(
        "Executing Claude Code command",
        workspace_id=workspace_id,
        mode=mode,
        model=model,
    )

    # Execute the command
    try:
        result = await compute_client.exec_command(
            workspace_id=workspace_id,
            user_id=user_id,
            command=cmd,
            exec_timeout=300,  # 5 minute timeout for long operations
        )

        stdout = result.get("stdout", "")
        exit_code = result.get("exit_code", 0)

        # Parse stream-json output
        content = ""
        thinking = ""
        tool_calls = []

        for line in stdout.strip().split("\n"):
            if not line.strip():
                continue

            try:
                event = json.loads(line)
                event_type = event.get("type", "")

                if event_type == "thinking":
                    thinking += event.get("thinking", "")
                elif event_type == "text":
                    content += event.get("text", "")
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
                    for tc in tool_calls:
                        if tc["id"] == tool_id:
                            tc["status"] = "error" if event.get("is_error") else "completed"
                            tc["result"] = event.get("content")
                elif event_type == "error":
                    error_msg = event.get("error", {}).get("message", "Unknown error")
                    content += f"\n\n❌ Error: {error_msg}"
                elif event_type in ("system", "config", "config_change") and on_config_change:
                    # Handle config changes (model, mode, etc.)
                    config_updates = {}
                    if "model" in event:
                        config_updates["model"] = event["model"]
                    if "mode" in event:
                        config_updates["mode"] = event["mode"]
                    if config_updates:
                        await on_config_change(config_updates)

            except json.JSONDecodeError:
                # Non-JSON output - append to content
                content += line + "\n"

        return {
            "content": content.strip(),
            "thinking": thinking if thinking else None,
            "tool_calls": tool_calls if tool_calls else None,
            "exit_code": exit_code,
            "success": exit_code == 0,
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
        result = await compute_client.exec_command(
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
        result = await compute_client.exec_command(
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
        verify_result = await compute_client.exec_command(
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
