"""
OpenAI Codex CLI Executor - runs OpenAI Codex CLI and translates output to agent messages.

This executor allows Podex to leverage the full capabilities of OpenAI Codex CLI
while presenting the output in the standard Podex agent message format.

Key features:
- Runs Codex CLI with `codex exec` for non-interactive mode
- Uses --json flag for structured JSONL output
- Parses JSONL events and converts to AgentMessage format
- Handles authentication flow via `codex login`
- Supports session resumption for context persistence

References:
- https://developers.openai.com/codex/cli/reference/
- https://developers.openai.com/codex/cli/features/
"""

from __future__ import annotations

import asyncio
import json
import shlex
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from typing import Protocol
    from uuid import UUID

    class DotfilesSync(Protocol):
        """Protocol for dotfiles sync service."""

        async def sync_to_workspace(
            self,
            user_id: UUID,
            workspace_path: str,
            paths: list[str],
        ) -> None: ...

        async def sync_from_workspace(
            self,
            user_id: UUID,
            workspace_path: str,
            paths: list[str],
        ) -> None: ...


logger = structlog.get_logger()


@dataclass
class ToolCall:
    """Represents a tool call from Codex."""

    id: str
    name: str
    status: str  # "pending" | "running" | "completed" | "error"
    args: dict[str, Any] | None = None
    result: Any = None


@dataclass
class AgentMessage:
    """
    Message format compatible with Podex frontend.
    This matches the existing AgentMessage structure used by other agents.
    """

    role: str  # "user" | "assistant" | "system"
    content: str = ""
    thinking: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "role": self.role,
            "content": self.content,
            "thinking": self.thinking,
            "tool_calls": [
                {
                    "id": tc.id,
                    "name": tc.name,
                    "status": tc.status,
                    "args": tc.args,
                    "result": tc.result,
                }
                for tc in self.tool_calls
            ],
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class CodexEvent:
    """Parsed event from Codex JSONL output."""

    type: str
    content: dict[str, Any]
    timestamp: datetime = field(default_factory=datetime.utcnow)

    # For tool events
    tool_name: str | None = None
    tool_input: dict[str, Any] | None = None
    tool_id: str | None = None

    # For error events
    is_error: bool = False
    error_message: str | None = None


def parse_codex_json_line(line: str) -> CodexEvent:
    """Parse a single line of Codex JSONL output."""
    data = json.loads(line)
    event_type = data.get("type", "unknown")

    match event_type:
        case "reasoning":
            # Codex uses "reasoning" for extended thinking (o3/o4-mini)
            return CodexEvent(
                type="thinking",
                content={"text": data.get("reasoning", "")},
            )

        case "message" | "text":
            return CodexEvent(
                type="text",
                content={"text": data.get("content", data.get("text", ""))},
            )

        case "function_call" | "tool_use":
            return CodexEvent(
                type="tool_use",
                content=data,
                tool_name=data.get("name", data.get("function", {}).get("name")),
                tool_input=data.get("arguments", data.get("input")),
                tool_id=data.get("id", data.get("call_id")),
            )

        case "function_result" | "tool_result":
            return CodexEvent(
                type="tool_result",
                content=data,
                tool_id=data.get("call_id", data.get("tool_use_id")),
                is_error=data.get("is_error", False),
            )

        case "error":
            return CodexEvent(
                type="error",
                content=data,
                is_error=True,
                error_message=data.get("error", {}).get("message", str(data.get("error"))),
            )

        case "session_start":
            # Capture session ID for resumption
            return CodexEvent(
                type="session_start",
                content=data,
            )

        case "system" | "config" | "config_change":
            # Handle config/system events for model changes etc.
            return CodexEvent(
                type="config_change",
                content=data,
            )

        case _:
            return CodexEvent(
                type=event_type,
                content=data,
            )


class OpenAICodexExecutor:
    """
    Executor that runs OpenAI Codex CLI.
    Translates JSONL output to standard AgentMessage format.
    """

    def __init__(
        self,
        workspace_path: str,
        dotfiles_sync: DotfilesSync | None = None,
    ):
        """
        Initialize the OpenAI Codex executor.

        Args:
            workspace_path: Path to the workspace directory
            dotfiles_sync: Optional service for syncing dotfiles/credentials
        """
        self.workspace_path = workspace_path
        self.dotfiles = dotfiles_sync
        self._process: asyncio.subprocess.Process | None = None
        self._session_id: str | None = None  # For session resumption

    async def check_installed(self) -> bool:
        """Check if Codex CLI is installed."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "which",
                "codex",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()
            return proc.returncode == 0
        except Exception:
            return False

    async def install(self) -> bool:
        """Install Codex CLI."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "npm",
                "install",
                "-g",
                "@openai/codex",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()
            return proc.returncode == 0
        except Exception as e:
            logger.error("Failed to install Codex CLI", error=str(e))
            return False

    async def check_auth(self, user_id: UUID | None = None) -> dict[str, Any]:
        """
        Check if Codex CLI is authenticated.

        If dotfiles_sync is configured and user_id provided, will first sync
        any existing credentials from user's dotfiles.
        """
        # Sync credentials from user dotfiles if available
        if self.dotfiles and user_id:
            try:
                await self.dotfiles.sync_to_workspace(
                    user_id=user_id,
                    workspace_path=self.workspace_path,
                    paths=[".codex/"],
                )
            except Exception as e:
                logger.warning("Failed to sync Codex credentials from dotfiles", error=str(e))

        # Check if config/auth exists
        config_path = f"{self.workspace_path}/.codex/config.toml"
        try:
            proc = await asyncio.create_subprocess_exec(
                "test",
                "-f",
                config_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()
            authenticated = proc.returncode == 0
        except Exception:
            authenticated = False

        return {
            "authenticated": authenticated,
            "needs_auth": not authenticated,
        }

    async def run_auth_flow(
        self,
        user_id: UUID | None = None,
    ) -> AsyncIterator[AgentMessage]:
        """
        Run Codex auth flow, streaming output to frontend.
        User sees the auth prompts and can click the login URL.
        """
        auth_message = AgentMessage(
            role="assistant",
            content="Starting OpenAI Codex authentication...\n\n",
        )
        yield auth_message

        # Run codex login
        try:
            proc = await asyncio.create_subprocess_exec(
                "codex",
                "login",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=self.workspace_path,
                env={
                    "HOME": self.workspace_path,
                    "PATH": "/usr/local/bin:/usr/bin:/bin",
                },
            )

            if proc.stdout:
                while True:
                    line = await proc.stdout.readline()
                    if not line:
                        break

                    output = line.decode("utf-8", errors="replace")
                    auth_message.content += output
                    yield auth_message

                    # Check for successful auth indicators
                    if "logged in" in output.lower() or "authenticated" in output.lower():
                        # Sync credentials to user dotfiles for persistence
                        if self.dotfiles and user_id:
                            try:
                                await self.dotfiles.sync_from_workspace(
                                    user_id=user_id,
                                    workspace_path=self.workspace_path,
                                    paths=[".codex/"],
                                )
                                auth_message.content += "\n\n✓ Credentials saved and synced."
                                yield auth_message
                            except Exception as e:
                                logger.warning(
                                    "Failed to sync Codex credentials to dotfiles", error=str(e)
                                )

            await proc.wait()

        except Exception as e:
            logger.error("Codex auth flow failed", error=str(e))
            auth_message.content += f"\n\n❌ Authentication failed: {e}"
            yield auth_message

    async def execute(
        self,
        message: str,
        user_id: UUID | None = None,
        mode: str = "ask",
        model: str | None = None,
        allowed_tools: list[str] | None = None,
        denied_tools: list[str] | None = None,
        max_turns: int = 50,
        thinking_budget: int | None = None,
        resume_session: bool = True,
        on_config_change: Any | None = None,
    ) -> AsyncIterator[AgentMessage]:
        """
        Execute a message using Codex CLI.
        Yields AgentMessage objects compatible with existing frontend.

        Args:
            message: The user message to send to Codex
            user_id: User ID for credential sync
            mode: Operation mode ("plan", "ask", "auto", "sovereign")
            model: Model name (defaults to gpt-5-codex)
            allowed_tools: List of allowed tool names
            denied_tools: List of denied tool names
            max_turns: Maximum number of turns
            thinking_budget: Extended thinking token budget (for o3/o4-mini)
            resume_session: Whether to resume previous session
            on_config_change: Optional async callback for config changes (model, mode, etc.)
        """
        # Ensure credentials are synced
        if self.dotfiles and user_id:
            await self.dotfiles.sync_to_workspace(
                user_id=user_id,
                workspace_path=self.workspace_path,
                paths=[".codex/"],
            )

        # Build command
        cmd = self._build_command(
            message=message,
            mode=mode,
            model=model,
            allowed_tools=allowed_tools,
            denied_tools=denied_tools,
            max_turns=max_turns,
            thinking_budget=thinking_budget,
            resume_session=resume_session and self._session_id is not None,
        )

        logger.info("Executing Codex command", cmd=cmd)

        # Execute and stream
        current_message = AgentMessage(role="assistant", content="")
        current_tool_calls: list[ToolCall] = []

        try:
            self._process = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=self.workspace_path,
                env={
                    "HOME": self.workspace_path,
                    "PATH": "/usr/local/bin:/usr/bin:/bin",
                    "OPENAI_API_KEY": "",  # Will use stored credentials
                },
            )

            if self._process.stdout:
                async for line in self._process.stdout:
                    line_str = line.decode("utf-8", errors="replace").strip()
                    if not line_str:
                        continue

                    try:
                        event = parse_codex_json_line(line_str)

                        # Capture session ID for future resumption
                        if event.type == "session_start":
                            self._session_id = event.content.get("session_id")
                            continue

                        if event.type == "thinking":
                            current_message.thinking = event.content.get("text", "")
                            yield current_message

                        elif event.type == "text":
                            current_message.content += event.content.get("text", "")
                            yield current_message

                        elif event.type == "tool_use":
                            tool_call = ToolCall(
                                id=event.tool_id or "",
                                name=event.tool_name or "",
                                status="running",
                                args=event.tool_input,
                            )
                            current_tool_calls.append(tool_call)
                            current_message.tool_calls = current_tool_calls
                            yield current_message

                        elif event.type == "tool_result":
                            for tc in current_tool_calls:
                                if tc.id == event.tool_id:
                                    tc.status = "error" if event.is_error else "completed"
                                    tc.result = event.content.get(
                                        "content", event.content.get("output")
                                    )
                            current_message.tool_calls = current_tool_calls
                            yield current_message

                        elif event.type == "error":
                            current_message.content += f"\n\n❌ Error: {event.error_message}"
                            yield current_message

                        elif event.type == "config_change":
                            # Handle config changes (model, mode, etc.)
                            if on_config_change:
                                config_updates = {}
                                if "model" in event.content:
                                    config_updates["model"] = event.content["model"]
                                if "mode" in event.content:
                                    config_updates["mode"] = event.content["mode"]
                                if config_updates:
                                    await on_config_change(config_updates)

                    except json.JSONDecodeError:
                        # Non-JSON output - append to content
                        current_message.content += line_str + "\n"
                        yield current_message

            await self._process.wait()

        except Exception as e:
            logger.error("Codex execution failed", error=str(e))
            current_message.content += f"\n\n❌ Execution failed: {e}"
            yield current_message

        finally:
            self._process = None

        # Mark any remaining tool calls as completed
        for tc in current_tool_calls:
            if tc.status == "running":
                tc.status = "completed"
        yield current_message

    def _build_command(
        self,
        message: str,
        mode: str,
        model: str | None,
        allowed_tools: list[str] | None,
        denied_tools: list[str] | None,
        max_turns: int,  # noqa: ARG002
        thinking_budget: int | None,
        resume_session: bool,
    ) -> str:
        """Build the codex CLI command with appropriate flags."""
        # Properly escape the message for shell
        escaped_message = shlex.quote(message)

        # Use codex exec for non-interactive mode
        parts = [
            "codex",
            "exec",
            "-p",
            escaped_message,
            "--json",  # JSONL output format
        ]

        # Model selection
        if model:
            parts.extend(["--model", model])

        # Mode handling
        # Codex uses --full-auto for sovereign/auto mode
        if mode in ("auto", "sovereign"):
            parts.append("--full-auto")

        # Session resumption
        if resume_session and self._session_id:
            parts.extend(["--session-id", self._session_id])

        # Tool restrictions (if supported by Codex)
        # Note: Check Codex docs for exact flags
        if allowed_tools:
            parts.extend(["--allowed-tools", ",".join(allowed_tools)])

        if denied_tools:
            parts.extend(["--denied-tools", ",".join(denied_tools)])

        # Thinking budget for o3/o4-mini models
        if thinking_budget:
            parts.extend(["--reasoning-effort", self._thinking_budget_to_effort(thinking_budget)])

        return " ".join(parts)

    def _thinking_budget_to_effort(self, budget: int) -> str:
        """Convert thinking budget to Codex reasoning effort level."""
        if budget <= 5000:
            return "low"
        elif budget <= 15000:
            return "medium"
        else:
            return "high"

    async def stop(self) -> bool:
        """Stop the currently running Codex process."""
        if self._process and self._process.returncode is None:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
                return True
            except TimeoutError:
                self._process.kill()
                return True
            except Exception as e:
                logger.error("Failed to stop Codex process", error=str(e))
                return False
        return False

    async def execute_slash_command(
        self,
        command: str,
        args: str | None = None,
        user_id: UUID | None = None,
    ) -> AsyncIterator[AgentMessage]:
        """
        Execute a slash command.

        Codex supports commands like /help, /compact, /status, etc.
        """
        full_command = f"/{command}"
        if args:
            full_command += f" {args}"

        # Pass through to Codex
        async for msg in self.execute(
            message=full_command,
            user_id=user_id,
            mode="auto",
        ):
            yield msg

    def clear_session(self) -> None:
        """Clear the current session, starting fresh on next execute."""
        self._session_id = None
