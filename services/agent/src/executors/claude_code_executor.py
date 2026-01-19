"""
Claude Code Executor - runs Claude Code CLI and translates output to agent messages.

This executor allows Podex to leverage the full capabilities of Claude Code CLI
while presenting the output in the standard Podex agent message format.

Key features:
- Runs Claude Code CLI with --output-format stream-json for structured output
- Parses stream-json events and converts to AgentMessage format
- Handles authentication flow by piping CLI output to frontend
- Syncs ~/.claude/ credentials to user dotfiles for persistence
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
    """Represents a tool call from Claude Code."""

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
class ClaudeCodeEvent:
    """Parsed event from Claude Code stream-json output."""

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


def parse_stream_json_line(line: str) -> ClaudeCodeEvent:
    """Parse a single line of Claude Code stream-json output."""
    data = json.loads(line)
    event_type = data.get("type", "unknown")

    match event_type:
        case "thinking":
            return ClaudeCodeEvent(
                type="thinking",
                content={"text": data.get("thinking", "")},
            )

        case "text":
            return ClaudeCodeEvent(
                type="text",
                content={"text": data.get("text", "")},
            )

        case "tool_use":
            return ClaudeCodeEvent(
                type="tool_use",
                content=data,
                tool_name=data.get("name"),
                tool_input=data.get("input"),
                tool_id=data.get("id"),
            )

        case "tool_result":
            return ClaudeCodeEvent(
                type="tool_result",
                content=data,
                tool_id=data.get("tool_use_id"),
                is_error=data.get("is_error", False),
            )

        case "error":
            return ClaudeCodeEvent(
                type="error",
                content=data,
                is_error=True,
                error_message=data.get("error", {}).get("message"),
            )

        case "message_start" | "message_delta" | "message_stop":
            return ClaudeCodeEvent(
                type=event_type,
                content=data,
            )

        case "system" | "config" | "config_change":
            # Handle config/system events for model changes etc.
            return ClaudeCodeEvent(
                type="config_change",
                content=data,
            )

        case _:
            return ClaudeCodeEvent(
                type=event_type,
                content=data,
            )


class ClaudeCodeExecutor:
    """
    Executor that runs Claude Code CLI instead of calling Anthropic API directly.
    Translates stream-json output to standard AgentMessage format.
    """

    def __init__(
        self,
        workspace_path: str,
        dotfiles_sync: DotfilesSync | None = None,
    ):
        """
        Initialize the Claude Code executor.

        Args:
            workspace_path: Path to the workspace directory in the container
            dotfiles_sync: Optional service for syncing dotfiles/credentials
        """
        self.workspace_path = workspace_path
        self.dotfiles = dotfiles_sync
        self._process: asyncio.subprocess.Process | None = None

    async def check_installed(self) -> bool:
        """Check if Claude Code CLI is installed."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "which",
                "claude",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()
            return proc.returncode == 0
        except Exception:
            return False

    async def install(self) -> bool:
        """Install Claude Code CLI."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "npm",
                "install",
                "-g",
                "@anthropic-ai/claude-code",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()
            return proc.returncode == 0
        except Exception as e:
            logger.error("Failed to install Claude Code CLI", error=str(e))
            return False

    async def check_auth(self, user_id: UUID | None = None) -> dict[str, Any]:
        """
        Check if Claude Code is authenticated.

        If dotfiles_sync is configured and user_id provided, will first sync
        any existing credentials from user's dotfiles.
        """
        # Sync credentials from user dotfiles if available
        if self.dotfiles and user_id:
            try:
                await self.dotfiles.sync_to_workspace(
                    user_id=user_id,
                    workspace_path=self.workspace_path,
                    paths=[".claude/"],
                )
            except Exception as e:
                logger.warning("Failed to sync credentials from dotfiles", error=str(e))

        # Check if credentials file exists
        credentials_path = f"{self.workspace_path}/.claude/credentials.json"
        try:
            proc = await asyncio.create_subprocess_exec(
                "test",
                "-f",
                credentials_path,
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
        Run Claude Code auth flow, streaming output to frontend.
        User sees the auth prompts and can click the login URL.
        """
        auth_message = AgentMessage(
            role="assistant",
            content="Starting Claude Code authentication...\n\n",
        )
        yield auth_message

        # Run claude in interactive mode to trigger auth
        try:
            proc = await asyncio.create_subprocess_exec(
                "claude",
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
                    if "successfully" in output.lower() and "logged in" in output.lower():
                        # Sync credentials to user dotfiles for persistence
                        if self.dotfiles and user_id:
                            try:
                                await self.dotfiles.sync_from_workspace(
                                    user_id=user_id,
                                    workspace_path=self.workspace_path,
                                    paths=[".claude/"],
                                )
                                auth_message.content += "\n\n✓ Credentials saved and synced."
                                yield auth_message
                            except Exception as e:
                                logger.warning(
                                    "Failed to sync credentials to dotfiles", error=str(e)
                                )

            await proc.wait()

        except Exception as e:
            logger.error("Auth flow failed", error=str(e))
            auth_message.content += f"\n\n❌ Authentication failed: {e}"
            yield auth_message

    async def execute(
        self,
        message: str,
        user_id: UUID | None = None,
        mode: str = "ask",
        model: str = "sonnet",
        allowed_tools: list[str] | None = None,
        denied_tools: list[str] | None = None,
        max_turns: int = 50,
        thinking_budget: int | None = None,
        on_config_change: Any | None = None,
    ) -> AsyncIterator[AgentMessage]:
        """
        Execute a message using Claude Code CLI.
        Yields AgentMessage objects compatible with existing frontend.

        Args:
            message: The user message to send to Claude Code
            user_id: User ID for credential sync
            mode: Operation mode ("plan", "ask", "auto")
            model: Model alias ("sonnet", "opus", "haiku")
            allowed_tools: List of allowed tool names
            denied_tools: List of denied tool names
            max_turns: Maximum number of turns
            thinking_budget: Extended thinking token budget
            on_config_change: Optional async callback for config changes (model, mode, etc.)
        """
        # Ensure credentials are synced
        if self.dotfiles and user_id:
            await self.dotfiles.sync_to_workspace(
                user_id=user_id,
                workspace_path=self.workspace_path,
                paths=[".claude/"],
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
        )

        logger.info("Executing Claude Code command", cmd=cmd)

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
                        event = parse_stream_json_line(line_str)

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
                                    tc.result = event.content.get("content")
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
            logger.error("Claude Code execution failed", error=str(e))
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
        model: str,
        allowed_tools: list[str] | None,
        denied_tools: list[str] | None,
        max_turns: int,
        thinking_budget: int | None,
    ) -> str:
        """Build the claude CLI command with appropriate flags."""
        # Properly escape the message for shell
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

        return " ".join(parts)

    async def stop(self) -> bool:
        """Stop the currently running Claude Code process."""
        if self._process and self._process.returncode is None:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
                return True
            except TimeoutError:
                self._process.kill()
                return True
            except Exception as e:
                logger.error("Failed to stop Claude Code process", error=str(e))
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

        Some commands like /help and /config are handled specially.
        Others are passed through to Claude Code as messages.
        """
        full_command = f"/{command}"
        if args:
            full_command += f" {args}"

        # Pass through to Claude Code
        async for msg in self.execute(
            message=full_command,
            user_id=user_id,
            mode="auto",
        ):
            yield msg
