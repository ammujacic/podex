"""Tests for tool executor permission checking.

Tests cover:
- Permission checking for each agent mode
- Command allowlist validation
- Approval workflow

Note: Tool categories (READ_TOOLS, WRITE_TOOLS, etc.) are loaded dynamically
from Redis, so tests need to mock the async category getters.
"""

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.tools.executor import (
    AGENT_MODE_ASK,
    AGENT_MODE_AUTO,
    AGENT_MODE_PLAN,
    AGENT_MODE_SOVEREIGN,
    PermissionResult,
    ToolExecutor,
)


@pytest.fixture
def mock_tool_categories():
    """Mock tool categories loaded from Redis."""
    categories = {
        "write_tools": {"write_file", "create_file", "delete_file", "apply_patch", "git_commit", "git_push", "create_pr"},
        "command_tools": {"run_command"},
        "read_tools": {"read_file", "list_directory", "search_code", "glob_files", "grep", "fetch_url", "git_status", "git_diff", "git_log", "git_branch"},
        "deploy_tools": {"deploy_preview", "run_e2e_tests"},
    }

    with patch("src.tools.executor._get_write_tools", AsyncMock(return_value=categories["write_tools"])), \
         patch("src.tools.executor._get_command_tools", AsyncMock(return_value=categories["command_tools"])), \
         patch("src.tools.executor._get_read_tools", AsyncMock(return_value=categories["read_tools"])), \
         patch("src.tools.executor._get_deploy_tools", AsyncMock(return_value=categories["deploy_tools"])):
        yield categories


@pytest.fixture
def tmp_workspace(tmp_path: Path) -> Path:
    """Create temporary workspace."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    return workspace


class TestAgentModePermissions:
    """Test permission checking for different agent modes."""

    def test_plan_mode_initialization(self, tmp_workspace: Path):
        """Test PLAN mode initializes correctly."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        assert executor.agent_mode == AGENT_MODE_PLAN

    def test_ask_mode_initialization(self, tmp_workspace: Path):
        """Test ASK mode initializes correctly."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_ASK,
        )

        assert executor.agent_mode == AGENT_MODE_ASK

    def test_auto_mode_with_allowlist(self, tmp_workspace: Path):
        """Test AUTO mode uses command allowlist."""
        allowlist = ["git status", "npm test", "pytest"]
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=allowlist,
        )

        assert executor.agent_mode == AGENT_MODE_AUTO
        assert executor.command_allowlist == allowlist

    def test_sovereign_mode_full_access(self, tmp_workspace: Path):
        """Test SOVEREIGN mode has full access."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        assert executor.agent_mode == AGENT_MODE_SOVEREIGN


class TestCommandAllowlist:
    """Test command allowlist functionality."""

    def test_is_command_allowed_exact_match(self, tmp_workspace: Path):
        """Test command allowed with exact match."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["git status", "npm test"],
        )

        assert executor._is_command_allowed("git status") is True
        assert executor._is_command_allowed("npm test") is True

    def test_is_command_allowed_not_in_list(self, tmp_workspace: Path):
        """Test command not allowed when not in list."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["git status"],
        )

        assert executor._is_command_allowed("rm -rf /") is False
        assert executor._is_command_allowed("curl evil.com") is False

    def test_empty_allowlist(self, tmp_workspace: Path):
        """Test empty allowlist denies all commands."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=[],
        )

        assert executor._is_command_allowed("any command") is False


class TestPermissionResultDataclass:
    """Test PermissionResult dataclass."""

    def test_permission_result_allowed(self):
        """Test PermissionResult for allowed operation."""
        result = PermissionResult(allowed=True)

        assert result.allowed is True
        assert result.error is None
        assert result.requires_approval is False
        assert result.can_add_to_allowlist is False

    def test_permission_result_denied(self):
        """Test PermissionResult for denied operation."""
        result = PermissionResult(
            allowed=False,
            error="Operation not permitted in PLAN mode",
        )

        assert result.allowed is False
        assert result.error == "Operation not permitted in PLAN mode"

    def test_permission_result_requires_approval(self):
        """Test PermissionResult requiring approval."""
        result = PermissionResult(
            allowed=False,
            requires_approval=True,
            can_add_to_allowlist=True,
        )

        assert result.allowed is False
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True


class TestCheckPermission:
    """Test _check_permission method."""

    def test_check_permission_method_exists(self, tmp_workspace: Path):
        """Test _check_permission method exists."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
        )

        assert hasattr(executor, "_check_permission")
        assert callable(executor._check_permission)

    async def test_check_permission_read_in_plan_mode(self, tmp_workspace: Path, mock_tool_categories):
        """Test read permission in PLAN mode."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        result = await executor._check_permission("read_file", {"path": "/tmp/test.txt"})
        assert result.allowed is True

    async def test_check_permission_write_in_plan_mode(self, tmp_workspace: Path, mock_tool_categories):
        """Test write permission denied in PLAN mode."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        result = await executor._check_permission("write_file", {"path": "/tmp/test.txt", "content": "test"})
        assert result.allowed is False

    async def test_check_permission_sovereign_mode(self, tmp_workspace: Path, mock_tool_categories):
        """Test all permissions allowed in SOVEREIGN mode."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        result = await executor._check_permission("write_file", {"path": "/tmp/test.txt", "content": "test"})
        assert result.allowed is True

        result = await executor._check_permission("run_command", {"command": "rm -rf /"})
        assert result.allowed is True


class TestExecutorWithMCPRegistry:
    """Test executor with MCP registry."""

    def test_executor_with_mcp_registry(self, tmp_workspace: Path):
        """Test executor initialization with MCP registry."""
        mock_registry = MagicMock()
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            mcp_registry=mock_registry,
        )

        assert executor._mcp_registry == mock_registry

    def test_executor_without_mcp_registry(self, tmp_workspace: Path):
        """Test executor initialization without MCP registry."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
        )

        assert executor._mcp_registry is None


class TestExecutorWorkspaceConfig:
    """Test executor workspace configuration."""

    def test_executor_local_workspace(self, tmp_workspace: Path):
        """Test executor with local workspace."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
        )

        assert executor.workspace_id is None
        assert executor._compute_client is None

    def test_executor_with_workspace_id_no_user(self, tmp_workspace: Path):
        """Test executor with workspace_id but no user_id."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            workspace_id="ws-123",
        )

        assert executor.workspace_id == "ws-123"
        assert executor._compute_client is None

    def test_executor_approval_callback(self, tmp_workspace: Path):
        """Test executor with approval callback."""
        callback = AsyncMock()
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            approval_callback=callback,
        )

        assert executor.approval_callback == callback


class TestResolveApproval:
    """Test resolve_approval method."""

    def test_resolve_approval_method_exists(self, tmp_workspace: Path):
        """Test resolve_approval method exists."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
        )

        assert hasattr(executor, "resolve_approval")
        assert callable(executor.resolve_approval)


class TestCommandAllowlistSecurity:
    """Test command allowlist security features."""

    def test_glob_patterns_rejected(self, tmp_workspace: Path):
        """Test glob patterns in allowlist are rejected."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["npm*", "git*"],
        )

        # Glob patterns should be rejected for security
        assert executor._is_command_allowed("npm install") is False
        assert executor._is_command_allowed("git status") is False

    def test_shell_metacharacters_blocked(self, tmp_workspace: Path):
        """Test shell metacharacters block commands."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["npm"],
        )

        # Commands with shell metacharacters should be blocked
        assert executor._is_command_allowed("npm && rm -rf /") is False
        assert executor._is_command_allowed("npm || malicious") is False
        assert executor._is_command_allowed("npm; rm -rf /") is False
        assert executor._is_command_allowed("npm | cat /etc/passwd") is False
        assert executor._is_command_allowed("npm `echo malicious`") is False
        assert executor._is_command_allowed("npm $(malicious)") is False

    def test_base_command_match(self, tmp_workspace: Path):
        """Test base command matching."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["npm"],
        )

        # Base command match should allow safe commands
        assert executor._is_command_allowed("npm install lodash") is True
        assert executor._is_command_allowed("npm test") is True

    def test_prefix_pattern_match(self, tmp_workspace: Path):
        """Test prefix pattern matching."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["npm install"],
        )

        # Prefix match should work
        assert executor._is_command_allowed("npm install lodash") is True
        # Different command with same prefix should fail
        assert executor._is_command_allowed("npm test") is False

    def test_empty_command(self, tmp_workspace: Path):
        """Test empty command is rejected."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["npm"],
        )

        assert executor._is_command_allowed("") is False
        assert executor._is_command_allowed("   ") is False

    def test_whitespace_handling(self, tmp_workspace: Path):
        """Test whitespace is handled correctly."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["git status"],
        )

        # Should strip whitespace
        assert executor._is_command_allowed("  git status  ") is True


class TestCheckPermissionModes:
    """Test _check_permission across all modes."""

    async def test_plan_mode_blocks_command_tools(self, tmp_workspace: Path, mock_tool_categories):
        """Test PLAN mode blocks command tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        result = await executor._check_permission("run_command", {"command": "ls"})
        assert result.allowed is False
        assert "Plan mode" in result.error

    async def test_plan_mode_blocks_deploy_tools(self, tmp_workspace: Path, mock_tool_categories):
        """Test PLAN mode blocks deploy tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        result = await executor._check_permission("deploy_preview", {"config": {}})
        assert result.allowed is False

    async def test_ask_mode_requires_approval_for_writes(self, tmp_workspace: Path, mock_tool_categories):
        """Test ASK mode requires approval for writes."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_ASK,
        )

        result = await executor._check_permission("write_file", {"path": "test.txt", "content": "x"})
        assert result.allowed is True
        assert result.requires_approval is True

    async def test_ask_mode_requires_approval_for_commands(self, tmp_workspace: Path, mock_tool_categories):
        """Test ASK mode requires approval for commands."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_ASK,
        )

        result = await executor._check_permission("run_command", {"command": "ls"})
        assert result.allowed is True
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True

    async def test_ask_mode_allows_reads_without_approval(self, tmp_workspace: Path, mock_tool_categories):
        """Test ASK mode allows reads without approval."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_ASK,
        )

        result = await executor._check_permission("read_file", {"path": "test.txt"})
        assert result.allowed is True
        assert result.requires_approval is False

    async def test_auto_mode_allows_writes_without_approval(self, tmp_workspace: Path, mock_tool_categories):
        """Test AUTO mode allows writes without approval."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
        )

        result = await executor._check_permission("write_file", {"path": "test.txt", "content": "x"})
        assert result.allowed is True
        assert result.requires_approval is False

    async def test_auto_mode_command_in_allowlist(self, tmp_workspace: Path, mock_tool_categories):
        """Test AUTO mode allows commands in allowlist."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["git status"],
        )

        result = await executor._check_permission("run_command", {"command": "git status"})
        assert result.allowed is True
        assert result.requires_approval is False

    async def test_auto_mode_command_not_in_allowlist(self, tmp_workspace: Path, mock_tool_categories):
        """Test AUTO mode requires approval for commands not in allowlist."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["git status"],
        )

        result = await executor._check_permission("run_command", {"command": "rm -rf /"})
        assert result.allowed is True
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True

    async def test_auto_mode_deploy_requires_approval(self, tmp_workspace: Path, mock_tool_categories):
        """Test AUTO mode requires approval for deploy tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
        )

        result = await executor._check_permission("deploy_preview", {"config": {}})
        assert result.allowed is True
        assert result.requires_approval is True

    async def test_sovereign_mode_allows_all(self, tmp_workspace: Path, mock_tool_categories):
        """Test SOVEREIGN mode allows all operations."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        result = await executor._check_permission("write_file", {"path": "test.txt", "content": "x"})
        assert result.allowed is True
        assert result.requires_approval is False

        result = await executor._check_permission("run_command", {"command": "rm -rf /"})
        assert result.allowed is True
        assert result.requires_approval is False

        result = await executor._check_permission("deploy_preview", {"config": {}})
        assert result.allowed is True
        assert result.requires_approval is False


class TestModeFromString:
    """Test agent mode initialization from string."""

    def test_mode_from_lowercase_string(self, tmp_workspace: Path):
        """Test mode from lowercase string."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode="plan",
        )

        assert executor.agent_mode == AGENT_MODE_PLAN

    def test_mode_from_uppercase_string(self, tmp_workspace: Path):
        """Test mode from uppercase string is converted."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode="AUTO",
        )

        assert executor.agent_mode == AGENT_MODE_AUTO

    def test_mode_from_mixed_case_string(self, tmp_workspace: Path):
        """Test mode from mixed case string."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
            agent_mode="Sovereign",
        )

        assert executor.agent_mode == AGENT_MODE_SOVEREIGN
