"""Safe execution of user-defined hooks."""

import asyncio
import json
import os
import shlex
import time
from typing import Any

import structlog

from .registry import HookRegistry, get_hook_registry
from .types import HookContext, HookDefinition, HookResult, HookType

logger = structlog.get_logger()

# SECURITY: Characters that are dangerous in shell commands
_DANGEROUS_SHELL_PATTERNS = frozenset(
    {
        "&&",
        "||",
        ";",
        "|",
        "`",
        "$(",
        "${",
        "<(",
        ">(",
        "\n",
        "\r",
        ">>",
        "<<",
        ">&",
        "<&",
        "\\n",
        "\\r",
    }
)


def _validate_hook_command(command: str) -> str | None:
    """Validate hook command for shell injection patterns.

    SECURITY: Prevents command injection by rejecting dangerous patterns.

    Args:
        command: The command string to validate.

    Returns:
        Error message if command is dangerous, None if safe.
    """
    for pattern in _DANGEROUS_SHELL_PATTERNS:
        if pattern in command:
            return f"Hook command contains forbidden pattern: {pattern!r}"
    return None


class HookExecutor:
    """
    Safely executes user-defined hooks.

    Features:
    - Sandboxed subprocess execution
    - Timeout enforcement
    - Environment variable injection
    - Async/sync execution modes
    - Result capture and logging
    """

    def __init__(self, registry: HookRegistry | None = None):
        self._registry = registry or get_hook_registry()
        # Execution history for debugging
        self._execution_history: list[HookResult] = []
        # Track background tasks to prevent garbage collection
        self._background_tasks: set[asyncio.Task[HookResult]] = set()

    async def execute_hooks(
        self,
        user_id: str,
        context: HookContext,
    ) -> list[HookResult]:
        """
        Execute all matching hooks for an event.

        Returns list of results from all executed hooks.
        """
        hooks = self._registry.get_hooks_for_event(
            user_id=user_id,
            hook_type=context.hook_type,
            tool_name=context.tool_name,
            file_path=context.file_path,
        )

        if not hooks:
            return []

        results = []
        for hook in hooks:
            if hook.run_async:
                # Fire and forget - store reference to prevent garbage collection
                task = asyncio.create_task(self._execute_hook(hook, context))
                self._background_tasks.add(task)
                task.add_done_callback(self._background_tasks.discard)
                results.append(
                    HookResult(
                        hook_id=hook.id,
                        success=True,
                        output="Running asynchronously",
                    )
                )
            else:
                result = await self._execute_hook(hook, context)
                results.append(result)

        return results

    async def _execute_hook(
        self,
        hook: HookDefinition,
        context: HookContext,
    ) -> HookResult:
        """Execute a single hook."""
        start_time = time.time()

        try:
            # Build environment variables
            env = self._build_env(context)

            # Execute command
            result = await asyncio.wait_for(
                self._run_command(hook.command, env),
                timeout=hook.timeout_ms / 1000,
            )

            duration_ms = int((time.time() - start_time) * 1000)

            logger.info(
                "hook_executed",
                hook_id=hook.id,
                hook_name=hook.name,
                success=True,
                duration_ms=duration_ms,
            )

            hook_result = HookResult(
                hook_id=hook.id,
                success=True,
                output=result,
                duration_ms=duration_ms,
            )

        except TimeoutError:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.warning(
                "hook_timeout",
                hook_id=hook.id,
                hook_name=hook.name,
                timeout_ms=hook.timeout_ms,
            )
            hook_result = HookResult(
                hook_id=hook.id,
                success=False,
                error=f"Hook timed out after {hook.timeout_ms}ms",
                duration_ms=duration_ms,
            )

        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error(
                "hook_failed",
                hook_id=hook.id,
                hook_name=hook.name,
                error=str(e),
            )
            hook_result = HookResult(
                hook_id=hook.id,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

        self._execution_history.append(hook_result)
        # Keep last 100 results
        if len(self._execution_history) > 100:
            self._execution_history = self._execution_history[-100:]

        return hook_result

    def _build_env(self, context: HookContext) -> dict[str, str]:
        """Build environment variables for hook execution."""
        env = os.environ.copy()

        # Add hook context variables
        env["PODEX_HOOK_TYPE"] = context.hook_type.value
        env["PODEX_SESSION_ID"] = context.session_id
        env["PODEX_AGENT_ID"] = context.agent_id

        if context.tool_name:
            env["PODEX_TOOL_NAME"] = context.tool_name

        if context.tool_args:
            env["PODEX_TOOL_ARGS"] = json.dumps(context.tool_args)

        if context.tool_result:
            # Truncate large results
            result = (
                context.tool_result[:10000]
                if len(context.tool_result) > 10000
                else context.tool_result
            )
            env["PODEX_TOOL_RESULT"] = result

        if context.file_path:
            env["PODEX_FILE_PATH"] = context.file_path

        if context.message_content:
            # Truncate large messages
            content = (
                context.message_content[:5000]
                if len(context.message_content) > 5000
                else context.message_content
            )
            env["PODEX_MESSAGE_CONTENT"] = content

        # Add metadata as JSON
        if context.metadata:
            env["PODEX_METADATA"] = json.dumps(context.metadata)

        return env

    async def _run_command(self, command: str, env: dict[str, str]) -> str:
        """Run a command safely and return output.

        SECURITY: Uses create_subprocess_exec instead of create_subprocess_shell
        to prevent command injection. Commands are parsed with shlex and validated
        for dangerous patterns.
        """
        # SECURITY: Validate command for dangerous patterns
        validation_error = _validate_hook_command(command)
        if validation_error:
            raise ValueError(validation_error)

        # SECURITY: Parse command with shlex to get argument list
        # This prevents shell injection by treating the command as a simple
        # executable with arguments, not a shell script
        try:
            cmd_parts = shlex.split(command)
        except ValueError as e:
            raise ValueError(f"Invalid command syntax: {e}") from e

        if not cmd_parts:
            raise ValueError("Empty command")

        # SECURITY: Use create_subprocess_exec instead of create_subprocess_shell
        process = await asyncio.create_subprocess_exec(
            *cmd_parts,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            # Security: don't inherit file descriptors
            close_fds=True,
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_msg = stderr.decode() if stderr else f"Exit code: {process.returncode}"
            raise RuntimeError(f"Hook command failed: {error_msg}")

        return stdout.decode() if stdout else ""

    def get_execution_history(
        self,
        hook_id: str | None = None,
        limit: int = 20,
    ) -> list[HookResult]:
        """Get recent execution history."""
        history = self._execution_history

        if hook_id:
            history = [r for r in history if r.hook_id == hook_id]

        return history[-limit:]


# Global instance
_executor: HookExecutor | None = None


def get_hook_executor() -> HookExecutor:
    """Get or create the global hook executor instance."""
    global _executor
    if _executor is None:
        _executor = HookExecutor()
    return _executor


async def run_hooks(
    user_id: str,
    hook_type: HookType,
    session_id: str,
    agent_id: str,
    **kwargs: Any,
) -> list[HookResult]:
    """
    Convenience function to run hooks for an event.

    Example:
        await run_hooks(
            user_id="user-123",
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-456",
            agent_id="agent-789",
            tool_name="write_file",
            file_path="/path/to/file.py",
        )
    """
    executor = get_hook_executor()
    context = HookContext(
        hook_type=hook_type,
        session_id=session_id,
        agent_id=agent_id,
        tool_name=kwargs.get("tool_name"),
        tool_args=kwargs.get("tool_args"),
        tool_result=kwargs.get("tool_result"),
        file_path=kwargs.get("file_path"),
        message_content=kwargs.get("message_content"),
        metadata=kwargs.get("metadata", {}),
    )
    return await executor.execute_hooks(user_id, context)
