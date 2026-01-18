"""Gemini CLI API routes for native Gemini integration.

These routes handle Gemini CLI-specific functionality like:
- Checking/managing authentication status
- Running slash commands
- Managing session resumption
- Re-authentication flow

References:
- https://google-gemini.github.io/gemini-cli/docs/cli/commands.html
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md
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
from src.routes.dependencies import DbSession, get_current_user_id

logger = structlog.get_logger()

router = APIRouter(prefix="/gemini-cli", tags=["gemini-cli"])


# ==================== Request/Response Models ====================


class AuthStatusResponse(BaseModel):
    """Gemini CLI authentication status."""

    authenticated: bool
    needs_auth: bool
    credentials_synced: bool = False


class SlashCommand(BaseModel):
    """Slash command definition."""

    name: str
    description: str
    builtin: bool = False


# ==================== Built-in Slash Commands ====================

BUILTIN_COMMANDS: list[SlashCommand] = [
    SlashCommand(name="help", description="Show all available commands", builtin=True),
    SlashCommand(name="clear", description="Clear conversation history", builtin=True),
    SlashCommand(
        name="memory", description="Manage AI's instructional context (GEMINI.md)", builtin=True
    ),
    SlashCommand(
        name="resume", description="Open session browser to resume a session", builtin=True
    ),
    SlashCommand(name="sessions", description="List available sessions", builtin=True),
    SlashCommand(name="status", description="Show current session status", builtin=True),
    SlashCommand(name="tools", description="List available tools/extensions", builtin=True),
    SlashCommand(name="model", description="Switch model", builtin=True),
    SlashCommand(name="web", description="Toggle web search capability", builtin=True),
    SlashCommand(name="save", description="Save current session", builtin=True),
]


# ==================== Helper Functions ====================


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
    """Check Gemini CLI authentication status for an agent.

    Checks if the workspace has valid Gemini credentials in ~/.gemini/
    """
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not session.workspace_id:
        return AuthStatusResponse(
            authenticated=False,
            needs_auth=True,
            credentials_synced=False,
        )

    # Check if credentials exist in workspace
    try:
        result = await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="test -f ~/.gemini/settings.json && echo 'authenticated'",
            exec_timeout=10,
        )
        authenticated = "authenticated" in result.get("stdout", "")
    except Exception as e:
        logger.warning("Failed to check Gemini auth status", error=str(e))
        authenticated = False

    return AuthStatusResponse(
        authenticated=authenticated,
        needs_auth=not authenticated,
        credentials_synced=False,
    )


@router.post("/agents/{agent_id}/reauthenticate")
async def reauthenticate(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, str]:
    """Clear Gemini credentials and trigger re-authentication.

    Next message to the agent will prompt for authentication.
    """
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="No workspace available")

    # Clear credentials
    try:
        await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="rm -rf ~/.gemini/settings.json ~/.config/gemini 2>/dev/null || true",
            exec_timeout=10,
        )
    except Exception as e:
        logger.warning("Failed to clear Gemini credentials", error=str(e))

    return {"status": "credentials_cleared"}


# ==================== Commands Endpoints ====================


@router.get("/commands", response_model=list[SlashCommand])
async def list_commands(request: Request) -> list[SlashCommand]:  # noqa: ARG001
    """List all available slash commands for Gemini CLI.

    Returns built-in commands.
    """
    return BUILTIN_COMMANDS


# ==================== Sessions Endpoints ====================


@router.get("/agents/{agent_id}/sessions")
async def list_sessions(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> list[dict[str, Any]]:
    """List available Gemini CLI sessions for resumption."""
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not session.workspace_id:
        return []

    try:
        result = await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="gemini --list-sessions 2>/dev/null || echo '[]'",
            exec_timeout=10,
        )
        stdout = result.get("stdout", "").strip()
    except Exception as e:
        logger.warning("Failed to list Gemini sessions", error=str(e))
        return []
    else:
        if stdout and stdout != "[]":
            try:
                parsed: list[dict[str, Any]] = json.loads(stdout)
            except json.JSONDecodeError:
                # Parse line by line if not JSON
                sessions = []
                for line in stdout.split("\n"):
                    if line.strip():
                        sessions.append({"id": line.strip()})
                return sessions
            else:
                return parsed
        return []


# ==================== Gemini Execution Helper ====================


async def execute_gemini_cli_message(
    workspace_id: str,
    user_id: str,
    message: str,
    mode: str = "ask",
    model: str | None = None,
    allowed_tools: list[str] | None = None,
    denied_tools: list[str] | None = None,
    max_turns: int = 50,  # noqa: ARG001
    thinking_budget: int | None = None,  # noqa: ARG001
    images: list[dict[str, Any]] | None = None,
    on_config_change: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    """Execute a message using Gemini CLI in a workspace.

    This is a non-streaming execution that returns the complete response.

    Args:
        workspace_id: The workspace where Gemini CLI is available
        user_id: User ID for authorization
        message: The user message to send to Gemini
        mode: Operation mode (plan, ask, auto, sovereign)
        model: Model name (defaults to gemini-2.0-flash)
        allowed_tools: List of allowed extensions
        denied_tools: List of disabled extensions
        max_turns: Maximum number of turns (not directly supported)
        thinking_budget: Extended thinking budget (for Gemini 2.0 thinking)
        images: Optional list of image attachments
        on_config_change: Optional callback for config changes (model, mode, etc.)

    Returns:
        Dict with response content, tool calls, and metadata
    """
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
                    await compute_client.exec_command(
                        workspace_id=workspace_id,
                        user_id=user_id,
                        command=f"echo '{data}' | base64 -d > {temp_name}",
                        exec_timeout=10,
                    )
                    image_paths.append(temp_name)
                except Exception as e:
                    logger.warning("Failed to save image attachment", error=str(e))

    # Build command
    escaped_message = shlex.quote(message)

    parts = [
        "gemini",
        "--prompt",
        escaped_message,
        "--output-format",
        "json",
    ]

    # Model selection
    if model:
        parts.extend(["--model", model])

    # Mode handling: --yolo for auto/sovereign modes
    if mode in ("auto", "sovereign"):
        parts.append("--yolo")

    # Sandbox mode (for safety in ask/plan modes)
    if mode in ("ask", "plan"):
        parts.append("--sandbox")

    # Extensions (tools) configuration
    if allowed_tools:
        parts.extend(["-e", ",".join(allowed_tools)])
    elif denied_tools:
        # Gemini doesn't have direct deny, but we can use -e none then enable specific
        pass

    # Add image files if present (Gemini supports --file for images)
    for img_path in image_paths:
        parts.extend(["--file", img_path])

    cmd = " ".join(parts)

    logger.info(
        "Executing Gemini command",
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

        # Parse JSON output
        content = ""
        thinking = ""
        tool_calls = []

        for line in stdout.strip().split("\n"):
            if not line.strip():
                continue

            try:
                event = json.loads(line)
                event_type = event.get("type", event.get("event", ""))

                if event_type in ("thinking", "thought"):
                    thinking += event.get("thinking", event.get("thought", ""))
                elif event_type in ("text", "content", "message"):
                    content += event.get("text", event.get("content", ""))
                elif event_type in ("function_call", "tool_call"):
                    fc = event.get("functionCall", event.get("function_call", event))
                    tool_calls.append(
                        {
                            "id": event.get("id", fc.get("id")),
                            "name": fc.get("name"),
                            "args": fc.get("args", fc.get("arguments")),
                            "status": "pending",
                        }
                    )
                elif event_type in ("function_response", "tool_response"):
                    fr = event.get("functionResponse", event.get("function_response", event))
                    tool_id = fr.get("id", event.get("id"))
                    for tc in tool_calls:
                        if tc["id"] == tool_id:
                            tc["status"] = "error" if fr.get("error") else "completed"
                            tc["result"] = fr.get("response", event.get("content"))
                elif event_type == "error":
                    error_msg = event.get("error", {}).get(
                        "message", str(event.get("error", "Unknown error"))
                    )
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
            "Gemini execution failed",
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


# ==================== Installation Check ====================


@router.get("/agents/{agent_id}/check-installation")
async def check_installation(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, Any]:
    """Check if Gemini CLI is installed in the workspace."""
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not session.workspace_id:
        return {
            "installed": False,
            "version": None,
            "message": "No workspace available",
        }

    try:
        # Check if gemini is installed
        check_result = await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="which gemini",
            exec_timeout=10,
        )
        installed = check_result.get("exit_code", 1) == 0

        version = None
        if installed:
            # Get version
            version_result = await compute_client.exec_command(
                workspace_id=session.workspace_id,
                user_id=user_id,
                command="gemini --version",
                exec_timeout=10,
            )
            version = version_result.get("stdout", "").strip()
    except Exception as e:
        logger.warning("Failed to check Gemini installation", error=str(e))
        return {
            "installed": False,
            "version": None,
            "message": str(e),
        }
    else:
        return {
            "installed": installed,
            "version": version,
            "message": None if installed else "Gemini CLI is not installed",
        }


@router.post("/agents/{agent_id}/install")
async def install_gemini(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, Any]:
    """Install Gemini CLI in the workspace."""
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="No workspace available")

    try:
        # Note: Check the actual package name - this might be different
        result = await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="npm install -g @anthropic-ai/gemini-cli",
            exec_timeout=120,
        )

        success = result.get("exit_code", 1) == 0

        return {
            "success": success,
            "output": result.get("stdout", ""),
            "error": result.get("stderr") if not success else None,
        }

    except Exception as e:
        logger.exception("Failed to install Gemini CLI", error=str(e))
        return {
            "success": False,
            "output": None,
            "error": str(e),
        }
