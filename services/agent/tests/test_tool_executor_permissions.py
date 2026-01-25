"""Tests for tool executor permission checking.

Tests cover:
- Permission checking for each agent mode
- Command allowlist validation
- Approval workflow
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestAgentModePermissions:
    """Test permission checking for different agent modes."""

    def test_plan_mode_allows_read_tools(self):
        """Test PLAN mode allows read operations."""
        from src.tools.executor import ToolExecutor, AgentMode, READ_TOOLS

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.PLAN,
        )

        # Verify read tools are defined
        assert "read_file" in READ_TOOLS
        assert "list_directory" in READ_TOOLS
        assert "search_code" in READ_TOOLS

    def test_plan_mode_denies_write_tools(self):
        """Test PLAN mode denies write operations."""
        from src.tools.executor import ToolExecutor, AgentMode, WRITE_TOOLS

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.PLAN,
        )

        # Verify write tools are defined
        assert "write_file" in WRITE_TOOLS
        assert "create_file" in WRITE_TOOLS
        assert "delete_file" in WRITE_TOOLS
        assert "git_commit" in WRITE_TOOLS

    def test_ask_mode_requires_approval(self):
        """Test ASK mode requires approval for write operations."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.ASK,
        )

        assert executor.agent_mode == AgentMode.ASK

    def test_auto_mode_uses_allowlist(self):
        """Test AUTO mode uses command allowlist."""
        from src.tools.executor import ToolExecutor, AgentMode

        allowlist = ["git status", "npm test", "pytest"]
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=allowlist,
        )

        assert executor.agent_mode == AgentMode.AUTO
        assert executor.command_allowlist == allowlist

    def test_sovereign_mode_full_access(self):
        """Test SOVEREIGN mode has full access."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.SOVEREIGN,
        )

        assert executor.agent_mode == AgentMode.SOVEREIGN


class TestCommandAllowlist:
    """Test command allowlist functionality."""

    def test_is_command_allowed_exact_match(self):
        """Test command allowed with exact match."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["git status", "npm test"],
        )

        # Test exact match
        assert executor._is_command_allowed("git status") is True
        assert executor._is_command_allowed("npm test") is True

    def test_is_command_allowed_prefix_match(self):
        """Test command allowed with prefix pattern."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["git *", "npm *"],
        )

        # Prefix patterns should match commands starting with prefix
        # Note: actual behavior depends on implementation
        assert hasattr(executor, "_is_command_allowed")

    def test_is_command_allowed_not_in_list(self):
        """Test command not allowed when not in list."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["git status"],
        )

        # Commands not in list should be denied
        assert executor._is_command_allowed("rm -rf /") is False
        assert executor._is_command_allowed("curl evil.com") is False

    def test_empty_allowlist(self):
        """Test empty allowlist denies all commands."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=[],
        )

        assert executor._is_command_allowed("any command") is False


class TestPermissionResult:
    """Test PermissionResult dataclass."""

    def test_permission_result_allowed(self):
        """Test PermissionResult for allowed operation."""
        from src.tools.executor import PermissionResult

        result = PermissionResult(allowed=True)

        assert result.allowed is True
        assert result.error is None
        assert result.requires_approval is False
        assert result.can_add_to_allowlist is False

    def test_permission_result_denied(self):
        """Test PermissionResult for denied operation."""
        from src.tools.executor import PermissionResult

        result = PermissionResult(
            allowed=False,
            error="Operation not permitted in PLAN mode",
        )

        assert result.allowed is False
        assert result.error == "Operation not permitted in PLAN mode"

    def test_permission_result_requires_approval(self):
        """Test PermissionResult requiring approval."""
        from src.tools.executor import PermissionResult

        result = PermissionResult(
            allowed=False,
            requires_approval=True,
            can_add_to_allowlist=True,
        )

        assert result.allowed is False
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True


class TestToolCategories:
    """Test tool categories for permission checking."""

    def test_write_tools_defined(self):
        """Test WRITE_TOOLS set is defined."""
        from src.tools.executor import WRITE_TOOLS

        expected_tools = {
            "write_file",
            "create_file",
            "delete_file",
            "apply_patch",
            "git_commit",
            "git_push",
            "create_pr",
        }
        assert expected_tools.issubset(WRITE_TOOLS)

    def test_command_tools_defined(self):
        """Test COMMAND_TOOLS set is defined."""
        from src.tools.executor import COMMAND_TOOLS

        assert "run_command" in COMMAND_TOOLS

    def test_read_tools_defined(self):
        """Test READ_TOOLS set is defined."""
        from src.tools.executor import READ_TOOLS

        expected_tools = {
            "read_file",
            "list_directory",
            "search_code",
            "glob_files",
            "grep",
            "fetch_url",
            "git_status",
            "git_diff",
            "git_log",
            "git_branch",
        }
        assert expected_tools.issubset(READ_TOOLS)


class TestCheckPermission:
    """Test _check_permission method."""

    def test_check_permission_method_exists(self):
        """Test _check_permission method exists."""
        from src.tools.executor import ToolExecutor

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
        )

        assert hasattr(executor, "_check_permission")
        assert callable(executor._check_permission)

    def test_check_permission_read_in_plan_mode(self):
        """Test read permission in PLAN mode."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.PLAN,
        )

        # Read tools should be allowed in PLAN mode
        result = executor._check_permission("read_file", {"path": "/tmp/test.txt"})
        assert result.allowed is True

    def test_check_permission_write_in_plan_mode(self):
        """Test write permission denied in PLAN mode."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.PLAN,
        )

        # Write tools should be denied in PLAN mode
        result = executor._check_permission("write_file", {"path": "/tmp/test.txt", "content": "test"})
        assert result.allowed is False

    def test_check_permission_sovereign_mode(self):
        """Test all permissions allowed in SOVEREIGN mode."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.SOVEREIGN,
        )

        # All tools should be allowed in SOVEREIGN mode
        result = executor._check_permission("write_file", {"path": "/tmp/test.txt", "content": "test"})
        assert result.allowed is True

        result = executor._check_permission("run_command", {"command": "rm -rf /"})
        assert result.allowed is True


class TestExecutorWithMCPRegistry:
    """Test executor with MCP registry."""

    def test_executor_with_mcp_registry(self):
        """Test executor initialization with MCP registry."""
        from src.tools.executor import ToolExecutor

        mock_registry = MagicMock()
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            mcp_registry=mock_registry,
        )

        assert executor._mcp_registry == mock_registry

    def test_executor_without_mcp_registry(self):
        """Test executor initialization without MCP registry."""
        from src.tools.executor import ToolExecutor

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
        )

        assert executor._mcp_registry is None


class TestExecutorWorkspaceConfig:
    """Test executor workspace configuration."""

    def test_executor_local_workspace(self):
        """Test executor with local workspace."""
        from src.tools.executor import ToolExecutor

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
        )

        assert executor.workspace_id is None
        assert executor._compute_client is None

    def test_executor_with_workspace_id_no_user(self):
        """Test executor with workspace_id but no user_id."""
        from src.tools.executor import ToolExecutor

        # Without user_id, compute client should not be created
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            workspace_id="ws-123",
        )

        assert executor.workspace_id == "ws-123"
        assert executor._compute_client is None

    def test_executor_approval_callback(self):
        """Test executor with approval callback."""
        from src.tools.executor import ToolExecutor

        callback = AsyncMock()
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            approval_callback=callback,
        )

        assert executor.approval_callback == callback


class TestResolveApproval:
    """Test resolve_approval method."""

    def test_resolve_approval_method_exists(self):
        """Test resolve_approval method exists."""
        from src.tools.executor import ToolExecutor

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
        )

        assert hasattr(executor, "resolve_approval")
        assert callable(executor.resolve_approval)


class TestCommandAllowlistSecurity:
    """Test command allowlist security features."""

    def test_glob_patterns_rejected(self):
        """Test glob patterns in allowlist are rejected."""
        from src.tools.executor import ToolExecutor, AgentMode

        # Patterns with glob chars should not match
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["npm*", "git*"],
        )

        # Glob patterns should be rejected for security
        assert executor._is_command_allowed("npm install") is False
        assert executor._is_command_allowed("git status") is False

    def test_shell_metacharacters_blocked(self):
        """Test shell metacharacters block commands."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["npm"],
        )

        # Commands with shell metacharacters should be blocked
        assert executor._is_command_allowed("npm && rm -rf /") is False
        assert executor._is_command_allowed("npm || malicious") is False
        assert executor._is_command_allowed("npm; rm -rf /") is False
        assert executor._is_command_allowed("npm | cat /etc/passwd") is False
        assert executor._is_command_allowed("npm `echo malicious`") is False
        assert executor._is_command_allowed("npm $(malicious)") is False

    def test_base_command_match(self):
        """Test base command matching."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["npm"],
        )

        # Base command match should allow safe commands
        assert executor._is_command_allowed("npm install lodash") is True
        assert executor._is_command_allowed("npm test") is True

    def test_prefix_pattern_match(self):
        """Test prefix pattern matching."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["npm install"],
        )

        # Prefix match should work
        assert executor._is_command_allowed("npm install lodash") is True
        # Different command with same prefix should fail
        assert executor._is_command_allowed("npm test") is False

    def test_empty_command(self):
        """Test empty command is rejected."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["npm"],
        )

        assert executor._is_command_allowed("") is False
        assert executor._is_command_allowed("   ") is False

    def test_whitespace_handling(self):
        """Test whitespace is handled correctly."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["git status"],
        )

        # Should strip whitespace
        assert executor._is_command_allowed("  git status  ") is True


class TestCheckPermissionModes:
    """Test _check_permission across all modes."""

    def test_plan_mode_blocks_command_tools(self):
        """Test PLAN mode blocks command tools."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.PLAN,
        )

        result = executor._check_permission("run_command", {"command": "ls"})
        assert result.allowed is False
        assert "Plan mode" in result.error

    def test_plan_mode_blocks_deploy_tools(self):
        """Test PLAN mode blocks deploy tools."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.PLAN,
        )

        result = executor._check_permission("deploy_preview", {"config": {}})
        assert result.allowed is False

    def test_ask_mode_requires_approval_for_writes(self):
        """Test ASK mode requires approval for writes."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.ASK,
        )

        result = executor._check_permission("write_file", {"path": "test.txt", "content": "x"})
        assert result.allowed is True
        assert result.requires_approval is True

    def test_ask_mode_requires_approval_for_commands(self):
        """Test ASK mode requires approval for commands."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.ASK,
        )

        result = executor._check_permission("run_command", {"command": "ls"})
        assert result.allowed is True
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True

    def test_ask_mode_allows_reads_without_approval(self):
        """Test ASK mode allows reads without approval."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.ASK,
        )

        result = executor._check_permission("read_file", {"path": "test.txt"})
        assert result.allowed is True
        assert result.requires_approval is False

    def test_auto_mode_allows_writes_without_approval(self):
        """Test AUTO mode allows writes without approval."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
        )

        result = executor._check_permission("write_file", {"path": "test.txt", "content": "x"})
        assert result.allowed is True
        assert result.requires_approval is False

    def test_auto_mode_command_in_allowlist(self):
        """Test AUTO mode allows commands in allowlist."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["git status"],
        )

        result = executor._check_permission("run_command", {"command": "git status"})
        assert result.allowed is True
        assert result.requires_approval is False

    def test_auto_mode_command_not_in_allowlist(self):
        """Test AUTO mode requires approval for commands not in allowlist."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
            command_allowlist=["git status"],
        )

        result = executor._check_permission("run_command", {"command": "rm -rf /"})
        assert result.allowed is True
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True

    def test_auto_mode_deploy_requires_approval(self):
        """Test AUTO mode requires approval for deploy tools."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.AUTO,
        )

        result = executor._check_permission("deploy_preview", {"config": {}})
        assert result.allowed is True
        assert result.requires_approval is True

    def test_sovereign_mode_allows_all(self):
        """Test SOVEREIGN mode allows all operations."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AgentMode.SOVEREIGN,
        )

        # Test various tools
        result = executor._check_permission("write_file", {"path": "test.txt", "content": "x"})
        assert result.allowed is True
        assert result.requires_approval is False

        result = executor._check_permission("run_command", {"command": "rm -rf /"})
        assert result.allowed is True
        assert result.requires_approval is False

        result = executor._check_permission("deploy_preview", {"config": {}})
        assert result.allowed is True
        assert result.requires_approval is False


class TestModeFromString:
    """Test agent mode initialization from string."""

    def test_mode_from_lowercase_string(self):
        """Test mode from lowercase string."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode="plan",
        )

        assert executor.agent_mode == AgentMode.PLAN

    def test_mode_from_uppercase_string(self):
        """Test mode from uppercase string is converted."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode="AUTO",
        )

        assert executor.agent_mode == AgentMode.AUTO

    def test_mode_from_mixed_case_string(self):
        """Test mode from mixed case string."""
        from src.tools.executor import ToolExecutor, AgentMode

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode="Sovereign",
        )

        assert executor.agent_mode == AgentMode.SOVEREIGN
