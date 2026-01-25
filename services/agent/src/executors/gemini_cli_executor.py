"""
Gemini CLI Executor - runs Google Gemini CLI and translates output to agent messages.

This executor allows Podex to leverage the full capabilities of Gemini CLI
while presenting the output in the standard Podex agent message format.

Key features:
- Runs Gemini CLI with `--prompt` for non-interactive mode
- Uses --output-format json for structured JSON output
- Parses JSON events and converts to AgentMessage format
- Handles authentication flow via Google OAuth
- Supports session resumption via --resume flag

References:
- https://google-gemini.github.io/gemini-cli/docs/cli/commands.html
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md
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
    """Represents a tool call from Gemini."""

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
class GeminiEvent:
    """Parsed event from Gemini JSON output."""

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


def parse_gemini_json_line(line: str) -> GeminiEvent:
    """Parse a single line of Gemini JSON output."""
    data = json.loads(line)
    event_type = data.get("type", data.get("event", "unknown"))

    match event_type:
        case "thinking" | "thought":
            # Gemini 2.0 thinking support
            return GeminiEvent(
                type="thinking",
                content={"text": data.get("thinking", data.get("thought", ""))},
            )

        case "text" | "content" | "message":
            return GeminiEvent(
                type="text",
                content={"text": data.get("text", data.get("content", ""))},
            )

        case "function_call" | "tool_call":
            fc = data.get("functionCall", data.get("function_call", data))
            return GeminiEvent(
                type="tool_use",
                content=data,
                tool_name=fc.get("name"),
                tool_input=fc.get("args", fc.get("arguments")),
                tool_id=data.get("id", fc.get("id")),
            )

        case "function_response" | "tool_response":
            fr = data.get("functionResponse", data.get("function_response", data))
            return GeminiEvent(
                type="tool_result",
                content=data,
                tool_id=fr.get("id", data.get("id")),
                is_error=fr.get("error") is not None,
            )

        case "error":
            return GeminiEvent(
                type="error",
                content=data,
                is_error=True,
                error_message=data.get("error", {}).get("message", str(data.get("error"))),
            )

        case "session":
            return GeminiEvent(
                type="session",
                content=data,
            )

        case "system" | "config" | "config_change":
            # Handle config/system events for model changes etc.
            return GeminiEvent(
                type="config_change",
                content=data,
            )

        case _:
            return GeminiEvent(
                type=event_type,
                content=data,
            )


class GeminiCliExecutor:
    """
    Executor that runs Google Gemini CLI.
    Translates JSON output to standard AgentMessage format.
    """

    def __init__(
        self,
        workspace_path: str,
        dotfiles_sync: DotfilesSync | None = None,
    ):
        """
        Initialize the Gemini CLI executor.

        Args:
            workspace_path: Path to the workspace directory
            dotfiles_sync: Optional service for syncing dotfiles/credentials
        """
        self.workspace_path = workspace_path
        self.dotfiles = dotfiles_sync
        self._process: asyncio.subprocess.Process | None = None
        self._resume_session: bool = False  # Whether to resume on next execute

    async def check_installed(self) -> bool:
        """Check if Gemini CLI is installed."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "which",
                "gemini",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()
            return proc.returncode == 0
        except Exception:
            return False

    async def install(self) -> bool:
        """Install Gemini CLI."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "npm",
                "install",
                "-g",
                "@anthropic-ai/gemini-cli",  # Check actual package name
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()
            return proc.returncode == 0
        except Exception as e:
            logger.error("Failed to install Gemini CLI", error=str(e))
            return False

    async def check_auth(self, user_id: UUID | None = None) -> dict[str, Any]:
        """
        Check if Gemini CLI is authenticated.

        If dotfiles_sync is configured and user_id provided, will first sync
        any existing credentials from user's dotfiles.
        """
        # Sync credentials from user dotfiles if available
        if self.dotfiles and user_id:
            try:
                await self.dotfiles.sync_to_workspace(
                    user_id=user_id,
                    workspace_path=self.workspace_path,
                    paths=[".gemini/"],
                )
            except Exception as e:
                logger.warning("Failed to sync Gemini credentials from dotfiles", error=str(e))

        # Check if settings/auth exists
        settings_path = f"{self.workspace_path}/.gemini/settings.json"
        try:
            proc = await asyncio.create_subprocess_exec(
                "test",
                "-f",
                settings_path,
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
        Run Gemini auth flow, streaming output to frontend.
        Gemini uses Google OAuth for authentication.
        """
        auth_message = AgentMessage(
            role="assistant",
            content="Starting Gemini CLI authentication...\n\n",
        )
        yield auth_message

        # Run gemini to trigger auth
        try:
            proc = await asyncio.create_subprocess_exec(
                "gemini",
                "--prompt",
                "hello",  # Minimal prompt to trigger auth
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
                    if "authenticated" in output.lower() or "logged in" in output.lower():
                        # Sync credentials to user dotfiles for persistence
                        if self.dotfiles and user_id:
                            try:
                                await self.dotfiles.sync_from_workspace(
                                    user_id=user_id,
                                    workspace_path=self.workspace_path,
                                    paths=[".gemini/"],
                                )
                                auth_message.content += "\n\n✓ Credentials saved and synced."
                                yield auth_message
                            except Exception as e:
                                logger.warning(
                                    "Failed to sync Gemini credentials to dotfiles", error=str(e)
                                )

            await proc.wait()

        except Exception as e:
            logger.error("Gemini auth flow failed", error=str(e))
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
        max_turns: int = 50,  # noqa: ARG002
        thinking_budget: int | None = None,  # noqa: ARG002
        sandbox: bool = True,
        include_directories: list[str] | None = None,
        on_config_change: Any | None = None,
    ) -> AsyncIterator[AgentMessage]:
        """
        Execute a message using Gemini CLI.
        Yields AgentMessage objects compatible with existing frontend.

        Args:
            message: The user message to send to Gemini
            user_id: User ID for credential sync
            mode: Operation mode ("plan", "ask", "auto", "sovereign")
            model: Model name (defaults to gemini-2.0-flash)
            allowed_tools: List of allowed extensions
            denied_tools: List of disabled extensions
            max_turns: Maximum number of turns
            thinking_budget: Extended thinking token budget
            sandbox: Whether to run in sandbox mode
            include_directories: Additional directories to include in workspace
            on_config_change: Optional async callback for config changes (model, mode, etc.)
        """
        # Ensure credentials are synced
        if self.dotfiles and user_id:
            await self.dotfiles.sync_to_workspace(
                user_id=user_id,
                workspace_path=self.workspace_path,
                paths=[".gemini/"],
            )

        # Build command
        cmd = self._build_command(
            message=message,
            mode=mode,
            model=model,
            allowed_tools=allowed_tools,
            denied_tools=denied_tools,
            sandbox=sandbox,
            include_directories=include_directories,
            resume=self._resume_session,
        )

        logger.info("Executing Gemini command", cmd=cmd)

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
                },
            )

            if self._process.stdout:
                async for line in self._process.stdout:
                    line_str = line.decode("utf-8", errors="replace").strip()
                    if not line_str:
                        continue

                    try:
                        event = parse_gemini_json_line(line_str)

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
                                        "response", event.content.get("content")
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

            # Enable session resumption for next message
            self._resume_session = True

        except Exception as e:
            logger.error("Gemini execution failed", error=str(e))
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
        sandbox: bool,
        include_directories: list[str] | None,
        resume: bool,
    ) -> str:
        """Build the gemini CLI command with appropriate flags."""
        # Properly escape the message for shell
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

        # Mode handling
        # Gemini doesn't have direct mode flags, but we can influence behavior
        # through yolo mode or sandbox settings
        if mode in ("auto", "sovereign"):
            parts.append("--yolo")  # Auto-approve actions

        # Session resumption
        if resume:
            parts.append("--resume")

        # Sandbox mode (enabled by default for safety)
        if sandbox:
            parts.append("--sandbox")

        # Extensions (tools) configuration
        if allowed_tools:
            # Use only specified extensions
            parts.extend(["-e", ",".join(allowed_tools)])
        elif denied_tools:
            # Gemini CLI doesn't support deny lists - only allow lists via -e flag
            # Skipping denied_tools as there's no CLI equivalent
            pass

        # Include additional directories
        if include_directories:
            for dir_path in include_directories:
                parts.extend(["--include-directories", dir_path])

        return " ".join(parts)

    async def stop(self) -> bool:
        """Stop the currently running Gemini process."""
        if self._process and self._process.returncode is None:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
                return True
            except TimeoutError:
                self._process.kill()
                return True
            except Exception as e:
                logger.error("Failed to stop Gemini process", error=str(e))
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

        Gemini supports commands like /help, /memory, /resume, etc.
        """
        full_command = f"/{command}"
        if args:
            full_command += f" {args}"

        # Pass through to Gemini
        async for msg in self.execute(
            message=full_command,
            user_id=user_id,
            mode="auto",
        ):
            yield msg

    def clear_session(self) -> None:
        """Clear the current session, starting fresh on next execute."""
        self._resume_session = False

    async def list_sessions(self) -> list[dict[str, Any]]:
        """List available sessions for resumption."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "gemini",
                "--list-sessions",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.workspace_path,
            )
            stdout, _ = await proc.communicate()

            # Parse session list (format depends on Gemini CLI version)
            sessions = []
            for line in stdout.decode().strip().split("\n"):
                if line.strip():
                    # Parse session info from output
                    sessions.append({"id": line.strip()})
            return sessions
        except Exception as e:
            logger.error("Failed to list Gemini sessions", error=str(e))
            return []
