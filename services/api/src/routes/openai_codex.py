"""OpenAI Codex CLI API routes for native Codex integration.

These routes handle OpenAI Codex-specific functionality like:
- Checking/managing authentication status
- Running slash commands
- Managing custom commands
- Re-authentication flow

References:
- https://developers.openai.com/codex/cli/reference/
- https://developers.openai.com/codex/cli/features/
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
from src.routes.sessions import ensure_workspace_provisioned

logger = structlog.get_logger()

router = APIRouter(prefix="/openai-codex", tags=["openai-codex"])


# ==================== Request/Response Models ====================


class AuthStatusResponse(BaseModel):
    """OpenAI Codex authentication status."""

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
    SlashCommand(name="compact", description="Compact context to reduce tokens", builtin=True),
    SlashCommand(name="config", description="View/modify configuration", builtin=True),
    SlashCommand(name="model", description="Switch model (e.g., /model gpt-5)", builtin=True),
    SlashCommand(name="status", description="Show current status", builtin=True),
    SlashCommand(name="resume", description="Resume a previous session", builtin=True),
    SlashCommand(name="diff", description="Show file changes", builtin=True),
    SlashCommand(name="web", description="Enable/disable web search", builtin=True),
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
    """Check OpenAI Codex authentication status for an agent.

    Checks if the workspace has valid Codex credentials in ~/.codex/
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

    # Ensure workspace is provisioned before running commands
    try:
        await ensure_workspace_provisioned(session, user_id, db)
    except Exception as e:
        logger.warning(
            "Failed to provision workspace for Codex auth check",
            agent_id=agent_id,
            workspace_id=session.workspace_id,
            error=str(e),
        )
        return AuthStatusResponse(
            authenticated=False,
            needs_auth=True,
            credentials_synced=False,
        )

    # Check if credentials exist in workspace
    # Note: Use absolute path /home/dev instead of ~ because exec runs as root
    try:
        result = await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="test -f /home/dev/.codex/config.toml && echo 'authenticated'",
            exec_timeout=10,
        )
        authenticated = "authenticated" in result.get("stdout", "")
    except Exception as e:
        logger.warning("Failed to check Codex auth status", error=str(e))
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
    """Clear Codex credentials and trigger re-authentication.

    Next message to the agent will prompt for authentication.
    """
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="No workspace available")

    # Clear credentials
    # Note: Use absolute path /home/dev instead of ~ because exec runs as root
    try:
        await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command=(
                "rm -rf /home/dev/.codex/config.toml /home/dev/.codex/credentials.json "
                "2>/dev/null || true"
            ),
            exec_timeout=10,
        )
    except Exception as e:
        logger.warning("Failed to clear Codex credentials", error=str(e))

    return {"status": "credentials_cleared"}


# ==================== Commands Endpoints ====================


@router.get("/commands", response_model=list[SlashCommand])
async def list_commands(request: Request) -> list[SlashCommand]:  # noqa: ARG001
    """List all available slash commands for Codex.

    Returns built-in commands.
    """
    return BUILTIN_COMMANDS


# ==================== Codex Execution Helper ====================


async def execute_openai_codex_message(
    workspace_id: str,
    user_id: str,
    message: str,
    mode: str = "ask",
    model: str | None = None,
    allowed_tools: list[str] | None = None,
    denied_tools: list[str] | None = None,
    max_turns: int = 50,  # noqa: ARG001
    thinking_budget: int | None = None,
    images: list[dict[str, Any]] | None = None,
    on_config_change: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    cli_session_id: str | None = None,
) -> dict[str, Any]:
    """Execute a message using OpenAI Codex CLI in a workspace.

    This is a non-streaming execution that returns the complete response.

    Args:
        workspace_id: The workspace where Codex CLI is available
        user_id: User ID for authorization
        message: The user message to send to Codex
        mode: Operation mode (plan, ask, auto, sovereign)
        model: Model name (defaults to gpt-5-codex)
        allowed_tools: List of allowed tool names
        denied_tools: List of denied tool names
        max_turns: Maximum number of turns
        thinking_budget: Extended thinking token budget (for o3/o4-mini)
        images: Optional list of image attachments
        on_config_change: Optional callback for config changes (model, mode, etc.)
        cli_session_id: Codex session ID to resume (for conversation continuity)

    Returns:
        Dict with response content, tool calls, and metadata (includes cli_session_id)
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

    # Use codex exec for non-interactive mode with JSONL output
    # Use PATH prefix to find codex in user's npm-global directory
    # Note: Use absolute path /home/dev instead of ~ because exec runs as root
    parts = [
        "PATH=/home/dev/.npm-global/bin:$PATH",
        "codex",
        "exec",
        "-p",
        escaped_message,
        "--json",  # JSONL output format
    ]

    # Model selection
    if model:
        parts.extend(["--model", model])

    # Mode handling: --full-auto for auto/sovereign modes
    if mode in ("auto", "sovereign"):
        parts.append("--full-auto")

    # Tool restrictions (if supported)
    if allowed_tools:
        parts.extend(["--allowed-tools", ",".join(allowed_tools)])

    if denied_tools:
        parts.extend(["--denied-tools", ",".join(denied_tools)])

    # Reasoning effort for o3/o4-mini models
    if thinking_budget:
        effort = (
            "low" if thinking_budget <= 5000 else "medium" if thinking_budget <= 15000 else "high"
        )
        parts.extend(["--reasoning-effort", effort])

    # Resume existing session for conversation continuity
    if cli_session_id:
        parts.extend(["--resume", cli_session_id])

    # Add image files if present (Codex may support --image flag)
    for img_path in image_paths:
        parts.extend(["--image", img_path])

    cmd = " ".join(parts)

    logger.info(
        "Executing Codex command",
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

        # Parse JSONL output
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
                event = json.loads(line)
                event_type = event.get("type", "")

                if event_type == "reasoning":
                    thinking += event.get("reasoning", "")
                elif event_type in ("message", "text"):
                    content += event.get("content", event.get("text", ""))
                elif event_type in ("function_call", "tool_use"):
                    fc = event.get("functionCall", event.get("function_call", event))
                    tool_calls.append(
                        {
                            "id": event.get("id", fc.get("id")),
                            "name": fc.get("name", event.get("name")),
                            "args": fc.get("arguments", event.get("input")),
                            "status": "pending",
                        }
                    )
                elif event_type in ("function_result", "tool_result"):
                    tool_id = event.get("call_id", event.get("tool_use_id"))
                    for tc in tool_calls:
                        if tc["id"] == tool_id:
                            tc["status"] = "error" if event.get("is_error") else "completed"
                            tc["result"] = event.get("content", event.get("output"))
                elif event_type == "error":
                    error_msg = event.get("error", {}).get(
                        "message", str(event.get("error", "Unknown error"))
                    )
                    content += f"\n\n❌ Error: {error_msg}"
                elif event_type in ("system", "init", "config", "config_change"):
                    # Capture session ID for conversation continuity
                    if "session_id" in event:
                        captured_session_id = event["session_id"]
                        logger.debug(
                            "Captured Codex CLI session ID",
                            cli_session_id=captured_session_id,
                        )
                    elif "sessionId" in event:
                        captured_session_id = event["sessionId"]
                        logger.debug(
                            "Captured Codex CLI session ID",
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
                    # Token usage event from Codex CLI
                    input_tokens = event.get(
                        "input_tokens", event.get("prompt_tokens", input_tokens)
                    )
                    output_tokens = event.get(
                        "output_tokens", event.get("completion_tokens", output_tokens)
                    )

                elif event_type == "result":
                    # Result event may contain final usage stats
                    usage = event.get("usage", {})
                    if usage:
                        input_tokens = usage.get(
                            "input_tokens", usage.get("prompt_tokens", input_tokens)
                        )
                        output_tokens = usage.get(
                            "output_tokens", usage.get("completion_tokens", output_tokens)
                        )

                # Check for usage in any event (OpenAI API format)
                if "usage" in event:
                    usage_data = event["usage"]
                    if isinstance(usage_data, dict):
                        input_tokens = int(
                            usage_data.get(
                                "input_tokens", usage_data.get("prompt_tokens", input_tokens)
                            )
                            or input_tokens
                        )
                        output_tokens = int(
                            usage_data.get(
                                "output_tokens", usage_data.get("completion_tokens", output_tokens)
                            )
                            or output_tokens
                        )

            except json.JSONDecodeError:
                # Non-JSON output - append to content
                content += line + "\n"

        # Calculate total tokens used for context tracking
        tokens_used = input_tokens + output_tokens

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
            "Codex execution failed",
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


# ==================== Installation Check ====================


@router.get("/agents/{agent_id}/check-installation")
async def check_installation(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, Any]:
    """Check if OpenAI Codex CLI is installed in the workspace."""
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
        # Check if codex is installed
        check_result = await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="which codex",
            exec_timeout=10,
        )
        installed = check_result.get("exit_code", 1) == 0

        version = None
        if installed:
            # Get version
            version_result = await compute_client.exec_command(
                workspace_id=session.workspace_id,
                user_id=user_id,
                command="codex --version",
                exec_timeout=10,
            )
            version = version_result.get("stdout", "").strip()
    except Exception as e:
        logger.warning("Failed to check Codex installation", error=str(e))
        return {
            "installed": False,
            "version": None,
            "message": str(e),
        }
    else:
        return {
            "installed": installed,
            "version": version,
            "message": None if installed else "Codex CLI is not installed",
        }


@router.post("/agents/{agent_id}/install")
async def install_codex(
    agent_id: str,
    request: Request,
    db: DbSession,
) -> dict[str, Any]:
    """Install OpenAI Codex CLI in the workspace."""
    user_id = get_current_user_id(request)

    agent, session = await get_agent_session(db, agent_id)
    if not agent or not session:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="No workspace available")

    try:
        result = await compute_client.exec_command(
            workspace_id=session.workspace_id,
            user_id=user_id,
            command="npm install -g @openai/codex",
            exec_timeout=120,
        )

        success = result.get("exit_code", 1) == 0

        return {
            "success": success,
            "output": result.get("stdout", ""),
            "error": result.get("stderr") if not success else None,
        }

    except Exception as e:
        logger.exception("Failed to install Codex", error=str(e))
        return {
            "success": False,
            "output": None,
            "error": str(e),
        }
