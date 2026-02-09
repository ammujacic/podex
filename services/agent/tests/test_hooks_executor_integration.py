"""Integration tests for hooks executor."""

import asyncio
import json
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.hooks.types import (
    HookContext,
    HookDefinition,
    HookResult,
    HookType,
    HookCondition,
    HookTrigger,
)


class TestHookCommandValidation:
    """Tests for hook command validation."""

    def test_validate_safe_command(self) -> None:
        """Test that safe commands pass validation."""
        from src.hooks.executor import _validate_hook_command

        safe_commands = [
            "echo hello",
            "python script.py",
            "/usr/bin/notify-send 'message'",
            "curl https://webhook.example.com",
        ]

        for cmd in safe_commands:
            result = _validate_hook_command(cmd)
            assert result is None, f"Command should be safe: {cmd}"

    def test_validate_dangerous_patterns(self) -> None:
        """Test that dangerous patterns are rejected."""
        from src.hooks.executor import _validate_hook_command

        dangerous_commands = [
            "echo hello && rm -rf /",
            "cat file.txt | grep secret",
            "echo `whoami`",
            "echo $(cat /etc/passwd)",
            "cmd1; cmd2",
            "echo hello || echo fallback",
            "cat << EOF > file",
            "echo hello\nrm -rf /",
        ]

        for cmd in dangerous_commands:
            result = _validate_hook_command(cmd)
            assert result is not None, f"Command should be rejected: {cmd}"
            assert "forbidden pattern" in result


class TestHookExecutor:
    """Tests for HookExecutor class."""

    def test_init_default_registry(self) -> None:
        """Test HookExecutor initialization with default registry."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()
        assert executor._registry is not None
        assert executor._execution_history == []
        assert executor._background_tasks == set()

    def test_init_custom_registry(self) -> None:
        """Test HookExecutor initialization with custom registry."""
        from src.hooks.executor import HookExecutor
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        executor = HookExecutor(registry=registry)
        assert executor._registry is registry

    @pytest.mark.asyncio
    async def test_build_env_basic(self) -> None:
        """Test building environment variables from context."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        context = HookContext(
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
            tool_name="read_file",
        )

        env = executor._build_env(context)

        assert env["PODEX_HOOK_TYPE"] == "post_tool_call"
        assert env["PODEX_SESSION_ID"] == "session-123"
        assert env["PODEX_AGENT_ID"] == "agent-456"
        assert env["PODEX_TOOL_NAME"] == "read_file"

    @pytest.mark.asyncio
    async def test_build_env_with_tool_args(self) -> None:
        """Test building environment with tool arguments."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        context = HookContext(
            hook_type=HookType.PRE_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
            tool_name="write_file",
            tool_args={"path": "/test/file.py", "content": "print('hello')"},
        )

        env = executor._build_env(context)

        assert "PODEX_TOOL_ARGS" in env
        args = json.loads(env["PODEX_TOOL_ARGS"])
        assert args["path"] == "/test/file.py"

    @pytest.mark.asyncio
    async def test_build_env_truncates_large_result(self) -> None:
        """Test that large tool results are truncated."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        large_result = "x" * 20000

        context = HookContext(
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
            tool_result=large_result,
        )

        env = executor._build_env(context)

        assert len(env["PODEX_TOOL_RESULT"]) == 10000

    @pytest.mark.asyncio
    async def test_build_env_with_metadata(self) -> None:
        """Test building environment with metadata."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        context = HookContext(
            hook_type=HookType.SESSION_START,
            session_id="session-123",
            agent_id="agent-456",
            metadata={"key1": "value1", "key2": 123},
        )

        env = executor._build_env(context)

        assert "PODEX_METADATA" in env
        metadata = json.loads(env["PODEX_METADATA"])
        assert metadata["key1"] == "value1"
        assert metadata["key2"] == 123

    @pytest.mark.asyncio
    async def test_run_command_success(self) -> None:
        """Test running a simple command successfully."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        result = await executor._run_command("echo hello", os.environ.copy())

        assert result.strip() == "hello"

    @pytest.mark.asyncio
    async def test_run_command_with_environment(self) -> None:
        """Test running command with custom environment."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        env = os.environ.copy()
        env["TEST_VAR"] = "test_value"

        # Use printenv or similar to verify env
        result = await executor._run_command("printenv TEST_VAR", env)

        assert result.strip() == "test_value"

    @pytest.mark.asyncio
    async def test_run_command_dangerous_rejected(self) -> None:
        """Test that dangerous commands are rejected."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        with pytest.raises(ValueError) as exc_info:
            await executor._run_command("echo hello && echo world", os.environ.copy())

        assert "forbidden pattern" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_run_command_invalid_syntax(self) -> None:
        """Test handling of invalid command syntax."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        with pytest.raises(ValueError) as exc_info:
            await executor._run_command('echo "unclosed quote', os.environ.copy())

        assert "Invalid command syntax" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_run_command_empty(self) -> None:
        """Test handling of empty command."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        with pytest.raises(ValueError) as exc_info:
            await executor._run_command("", os.environ.copy())

        assert "Empty command" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_run_command_failure(self) -> None:
        """Test handling of command failure."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        with pytest.raises(RuntimeError) as exc_info:
            await executor._run_command("false", os.environ.copy())  # 'false' always exits 1

        assert "Hook command failed" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_execute_hooks_no_matches(self) -> None:
        """Test executing hooks when no hooks match."""
        from src.hooks.executor import HookExecutor
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        executor = HookExecutor(registry=registry)

        context = HookContext(
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
            tool_name="read_file",
        )

        results = await executor.execute_hooks("user-123", context)

        assert results == []

    @pytest.mark.asyncio
    async def test_execute_hooks_sync_success(self) -> None:
        """Test executing synchronous hooks successfully."""
        from src.hooks.executor import HookExecutor
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        hook = registry.register_hook(
            user_id="user-123",
            name="Test Hook",
            hook_type=HookType.POST_TOOL_CALL,
            command="echo test",
            description="A test hook",
            condition=HookCondition(trigger=HookTrigger.ALWAYS),
            timeout_ms=5000,
            run_async=False,
        )

        executor = HookExecutor(registry=registry)

        context = HookContext(
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
        )

        results = await executor.execute_hooks("user-123", context)

        assert len(results) == 1
        assert results[0].success is True
        assert results[0].hook_id == hook.id
        assert "test" in results[0].output

    @pytest.mark.asyncio
    async def test_execute_hooks_async(self) -> None:
        """Test executing asynchronous hooks."""
        from src.hooks.executor import HookExecutor
        from src.hooks.registry import HookRegistry

        registry = HookRegistry()
        hook = registry.register_hook(
            user_id="user-123",
            name="Async Hook",
            hook_type=HookType.POST_TOOL_CALL,
            command="echo async",
            description="An async hook",
            condition=HookCondition(trigger=HookTrigger.ALWAYS),
            timeout_ms=5000,
            run_async=True,
        )

        executor = HookExecutor(registry=registry)

        context = HookContext(
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
        )

        results = await executor.execute_hooks("user-123", context)

        assert len(results) == 1
        assert results[0].success is True
        assert results[0].output == "Running asynchronously"

        # Wait for background task to complete
        await asyncio.sleep(0.1)

    @pytest.mark.asyncio
    async def test_execute_hook_timeout(self) -> None:
        """Test hook timeout handling."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        hook = HookDefinition(
            id="hook-slow",
            user_id="user-123",
            name="Slow Hook",
            description="A slow hook",
            hook_type=HookType.POST_TOOL_CALL,
            command="sleep 10",  # Will timeout
            condition=HookCondition(trigger=HookTrigger.ALWAYS),
            timeout_ms=100,  # 100ms timeout
            run_async=False,
        )

        context = HookContext(
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
        )

        result = await executor._execute_hook(hook, context)

        assert result.success is False
        assert "timed out" in result.error

    @pytest.mark.asyncio
    async def test_execution_history_maintained(self) -> None:
        """Test that execution history is maintained."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        hook = HookDefinition(
            id="hook-history",
            user_id="user-123",
            name="History Hook",
            description="A hook for history testing",
            hook_type=HookType.POST_TOOL_CALL,
            command="echo history",
            condition=HookCondition(trigger=HookTrigger.ALWAYS),
            timeout_ms=5000,
            run_async=False,
        )

        context = HookContext(
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
        )

        await executor._execute_hook(hook, context)
        await executor._execute_hook(hook, context)

        history = executor.get_execution_history()
        assert len(history) == 2

    @pytest.mark.asyncio
    async def test_execution_history_limited(self) -> None:
        """Test that execution history is limited to 100 entries."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        hook = HookDefinition(
            id="hook-limit",
            user_id="user-123",
            name="Limit Hook",
            description="A hook for limit testing",
            hook_type=HookType.POST_TOOL_CALL,
            command="echo limit",
            condition=HookCondition(trigger=HookTrigger.ALWAYS),
            timeout_ms=5000,
            run_async=False,
        )

        context = HookContext(
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
        )

        # Execute 105 times
        for _ in range(105):
            await executor._execute_hook(hook, context)

        # Use limit=200 to get all entries
        history = executor.get_execution_history(limit=200)
        assert len(history) == 100  # Capped at 100 entries

    @pytest.mark.asyncio
    async def test_get_execution_history_filtered(self) -> None:
        """Test getting execution history filtered by hook_id."""
        from src.hooks.executor import HookExecutor

        executor = HookExecutor()

        hook1 = HookDefinition(
            id="hook-1",
            user_id="user-123",
            name="Hook 1",
            description="First hook",
            hook_type=HookType.POST_TOOL_CALL,
            command="echo hook1",
            condition=HookCondition(trigger=HookTrigger.ALWAYS),
            timeout_ms=5000,
        )

        hook2 = HookDefinition(
            id="hook-2",
            user_id="user-123",
            name="Hook 2",
            description="Second hook",
            hook_type=HookType.POST_TOOL_CALL,
            command="echo hook2",
            condition=HookCondition(trigger=HookTrigger.ALWAYS),
            timeout_ms=5000,
        )

        context = HookContext(
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-123",
            agent_id="agent-456",
        )

        await executor._execute_hook(hook1, context)
        await executor._execute_hook(hook2, context)
        await executor._execute_hook(hook1, context)

        history = executor.get_execution_history(hook_id="hook-1")
        assert len(history) == 2
        assert all(r.hook_id == "hook-1" for r in history)


class TestRunHooksConvenience:
    """Tests for run_hooks convenience function."""

    @pytest.mark.asyncio
    async def test_run_hooks_creates_context(self) -> None:
        """Test that run_hooks creates proper context."""
        from src.hooks.executor import run_hooks, get_hook_executor
        from src.hooks.types import HookType

        # Get executor to check what happens
        executor = get_hook_executor()

        results = await run_hooks(
            user_id="user-123",
            hook_type=HookType.POST_TOOL_CALL,
            session_id="session-456",
            agent_id="agent-789",
            tool_name="read_file",
            file_path="/path/to/file.py",
        )

        # Should return empty list if no hooks registered
        assert results == []


class TestHookExecutorGlobal:
    """Tests for global hook executor instance."""

    def test_get_hook_executor_singleton(self) -> None:
        """Test that get_hook_executor returns singleton."""
        from src.hooks.executor import get_hook_executor

        executor1 = get_hook_executor()
        executor2 = get_hook_executor()

        assert executor1 is executor2
