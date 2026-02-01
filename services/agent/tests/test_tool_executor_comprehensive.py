"""Comprehensive tests for ToolExecutor.

Tests cover:
- Initialization with required parameters
- Permission checking by mode (async with Redis mock)
- Command allowlist functionality
- MCP tool detection
- Approval workflow
- Tool dispatch
"""

import asyncio
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


class TestToolExecutorInit:
    """Test ToolExecutor initialization."""

    @pytest.fixture
    def tmp_workspace(self, tmp_path: Path) -> Path:
        """Create temporary workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        return workspace

    def test_executor_initialization(self, tmp_workspace: Path):
        """Test executor initialization with required parameters."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_id="agent-456",
        )

        assert executor.session_id == "session-123"
        assert executor.agent_id == "agent-456"
        assert executor.agent_mode == AGENT_MODE_ASK  # Default mode

    def test_executor_with_mode(self, tmp_workspace: Path):
        """Test executor with explicit mode."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_AUTO,
        )

        assert executor.agent_mode == AGENT_MODE_AUTO

    def test_executor_with_user_id(self, tmp_workspace: Path):
        """Test executor with user_id."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            user_id="user-789",
        )

        assert executor.user_id == "user-789"

    def test_executor_with_command_allowlist(self, tmp_workspace: Path):
        """Test executor with command allowlist."""
        allowlist = ["ls", "cat", "npm install"]
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            command_allowlist=allowlist,
        )

        assert executor.command_allowlist == allowlist

    def test_executor_with_workspace_id(self, tmp_workspace: Path):
        """Test executor with workspace_id for remote execution."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            workspace_id="workspace-abc",
            user_id="user-123",
        )

        assert executor.workspace_id == "workspace-abc"

    def test_executor_invalid_mode_normalized(self, tmp_workspace: Path):
        """Test that invalid mode is normalized but fails permission checks safely."""
        # The executor doesn't raise for invalid modes - it normalizes to lowercase
        # and permission checks fail safely by blocking operations.
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode="invalid_mode",
        )
        # Mode is normalized to lowercase
        assert executor.agent_mode == "invalid_mode"

    def test_executor_mode_case_insensitive(self, tmp_workspace: Path):
        """Test that mode is normalized to lowercase."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode="ASK",
        )

        assert executor.agent_mode == AGENT_MODE_ASK


class TestToolExecutorModeConstants:
    """Test mode constants."""

    def test_mode_constants_values(self):
        """Test mode constant values."""
        assert AGENT_MODE_PLAN == "plan"
        assert AGENT_MODE_ASK == "ask"
        assert AGENT_MODE_AUTO == "auto"
        assert AGENT_MODE_SOVEREIGN == "sovereign"

    def test_all_modes_are_strings(self):
        """Test all agent modes are lowercase strings."""
        modes = [AGENT_MODE_PLAN, AGENT_MODE_ASK, AGENT_MODE_AUTO, AGENT_MODE_SOVEREIGN]
        for mode in modes:
            assert isinstance(mode, str)
            assert mode.islower()


class TestPermissionResult:
    """Test PermissionResult dataclass."""

    def test_permission_result_allowed(self):
        """Test allowed permission result."""
        result = PermissionResult(allowed=True)

        assert result.allowed is True
        assert result.error is None
        assert result.requires_approval is False

    def test_permission_result_denied(self):
        """Test denied permission result."""
        result = PermissionResult(
            allowed=False,
            error="Tool not allowed in Plan mode",
        )

        assert result.allowed is False
        assert result.error == "Tool not allowed in Plan mode"

    def test_permission_result_requires_approval(self):
        """Test permission requiring approval."""
        result = PermissionResult(
            allowed=True,
            requires_approval=True,
            can_add_to_allowlist=True,
        )

        assert result.allowed is True
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True


@pytest.fixture
def mock_tool_categories():
    """Mock tool categories loaded from Redis."""
    categories = {
        "write_tools": {"write_file", "create_file", "delete_file", "apply_patch", "git_commit", "git_push"},
        "command_tools": {"run_command"},
        "read_tools": {"read_file", "list_directory", "search_code", "glob_files", "grep", "git_status"},
        "deploy_tools": {"deploy_preview", "run_e2e_tests"},
    }

    with patch("src.tools.executor._get_write_tools", AsyncMock(return_value=categories["write_tools"])), \
         patch("src.tools.executor._get_command_tools", AsyncMock(return_value=categories["command_tools"])), \
         patch("src.tools.executor._get_read_tools", AsyncMock(return_value=categories["read_tools"])), \
         patch("src.tools.executor._get_deploy_tools", AsyncMock(return_value=categories["deploy_tools"])):
        yield categories


class TestToolExecutorPermissions:
    """Test permission checking by mode."""

    @pytest.fixture
    def tmp_workspace(self, tmp_path: Path) -> Path:
        """Create temporary workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        return workspace

    async def test_plan_mode_blocks_writes(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Plan mode blocks write tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_PLAN,
        )

        result = await executor._check_permission("write_file", {"path": "/test.txt"})

        assert result.allowed is False
        assert "Plan mode" in (result.error or "")

    async def test_plan_mode_blocks_commands(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Plan mode blocks commands."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_PLAN,
        )

        result = await executor._check_permission("run_command", {"command": "ls"})

        assert result.allowed is False

    async def test_plan_mode_allows_reads(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Plan mode allows read tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_PLAN,
        )

        result = await executor._check_permission("read_file", {"path": "/test.txt"})

        assert result.allowed is True
        assert result.requires_approval is False

    async def test_ask_mode_requires_approval_for_writes(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Ask mode requires approval for writes."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_ASK,
        )

        result = await executor._check_permission("write_file", {"path": "/test.txt"})

        assert result.allowed is True
        assert result.requires_approval is True

    async def test_ask_mode_requires_approval_for_commands(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Ask mode requires approval for commands."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_ASK,
        )

        result = await executor._check_permission("run_command", {"command": "npm install"})

        assert result.allowed is True
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True

    async def test_ask_mode_allows_reads_without_approval(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Ask mode allows reads without approval."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_ASK,
        )

        result = await executor._check_permission("read_file", {"path": "/test.txt"})

        assert result.allowed is True
        assert result.requires_approval is False

    async def test_auto_mode_allows_writes(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Auto mode allows writes without approval."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_AUTO,
        )

        result = await executor._check_permission("write_file", {"path": "/test.txt"})

        assert result.allowed is True
        assert result.requires_approval is False

    async def test_auto_mode_requires_approval_for_unlisted_commands(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Auto mode requires approval for commands not in allowlist."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["ls"],
        )

        result = await executor._check_permission("run_command", {"command": "rm -rf /"})

        assert result.allowed is True
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True

    async def test_auto_mode_allows_listed_commands(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Auto mode allows commands in allowlist."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["npm install"],
        )

        result = await executor._check_permission("run_command", {"command": "npm install"})

        assert result.allowed is True
        assert result.requires_approval is False

    async def test_sovereign_mode_allows_everything(self, tmp_workspace: Path, mock_tool_categories):
        """Test that Sovereign mode allows all operations."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        # Test writes
        result = await executor._check_permission("write_file", {"path": "/test.txt"})
        assert result.allowed is True
        assert result.requires_approval is False

        # Test commands
        result = await executor._check_permission("run_command", {"command": "rm -rf /"})
        assert result.allowed is True
        assert result.requires_approval is False


class TestCommandAllowlist:
    """Test command allowlist functionality."""

    @pytest.fixture
    def tmp_workspace(self, tmp_path: Path) -> Path:
        """Create temporary workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        return workspace

    def test_exact_command_match(self, tmp_workspace: Path):
        """Test exact command matching."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            command_allowlist=["npm install", "ls -la"],
        )

        assert executor._is_command_allowed("npm install") is True
        assert executor._is_command_allowed("ls -la") is True
        assert executor._is_command_allowed("rm -rf") is False

    def test_base_command_match(self, tmp_workspace: Path):
        """Test base command matching with arguments."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            command_allowlist=["npm"],
        )

        assert executor._is_command_allowed("npm install") is True
        assert executor._is_command_allowed("npm run build") is True

    def test_prefix_matching(self, tmp_workspace: Path):
        """Test prefix matching for commands."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            command_allowlist=["npm install"],
        )

        assert executor._is_command_allowed("npm install lodash") is True

    def test_rejects_shell_metacharacters(self, tmp_workspace: Path):
        """Test that commands with shell metacharacters are rejected."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            command_allowlist=["npm"],
        )

        # These should be blocked despite base command matching
        assert executor._is_command_allowed("npm && rm -rf /") is False
        assert executor._is_command_allowed("npm; dangerous") is False
        assert executor._is_command_allowed("npm | cat /etc/passwd") is False

    def test_rejects_glob_patterns(self, tmp_workspace: Path):
        """Test that glob patterns in allowlist are rejected for security."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            command_allowlist=["npm*"],  # Glob pattern
        )

        # Glob patterns should not match
        assert executor._is_command_allowed("npm install") is False

    def test_empty_command(self, tmp_workspace: Path):
        """Test that empty commands are rejected."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            command_allowlist=["ls"],
        )

        assert executor._is_command_allowed("") is False
        assert executor._is_command_allowed("   ") is False

    def test_empty_allowlist(self, tmp_workspace: Path):
        """Test that empty allowlist rejects all commands."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            command_allowlist=[],
        )

        assert executor._is_command_allowed("ls") is False


class TestMCPToolDetection:
    """Test MCP tool name detection."""

    @pytest.fixture
    def tmp_workspace(self, tmp_path: Path) -> Path:
        """Create temporary workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        return workspace

    def test_mcp_tool_name_detection(self, tmp_workspace: Path):
        """Test detection of MCP tool names."""
        from src.mcp.integration import is_mcp_tool_name

        assert is_mcp_tool_name("mcp:github:create_issue") is True
        assert is_mcp_tool_name("mcp:slack:send_message") is True
        assert is_mcp_tool_name("read_file") is False
        assert is_mcp_tool_name("write_file") is False

    def test_extract_mcp_qualified_name(self, tmp_workspace: Path):
        """Test extracting qualified name from MCP tool."""
        from src.mcp.integration import extract_mcp_qualified_name

        result = extract_mcp_qualified_name("mcp:github:create_issue")
        assert result == "github:create_issue"

        result = extract_mcp_qualified_name("read_file")
        assert result is None


class TestToolExecutorApproval:
    """Test approval workflow."""

    @pytest.fixture
    def tmp_workspace(self, tmp_path: Path) -> Path:
        """Create temporary workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        return workspace

    def test_resolve_approval_not_found(self, tmp_workspace: Path):
        """Test resolving non-existent approval."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_ASK,
        )

        result = executor.resolve_approval(
            approval_id="nonexistent",
            approved=True,
        )

        assert result is False

    def test_resolve_approval_local_fallback(self, tmp_workspace: Path):
        """Test local approval resolution when listener not available."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_ASK,
        )

        # Create a local pending approval
        future: asyncio.Future[tuple[bool, bool]] = asyncio.Future()
        approval_id = "test-approval-123"
        executor._pending_approvals[approval_id] = future

        # Resolve it
        result = executor.resolve_approval(
            approval_id=approval_id,
            approved=True,
            add_to_allowlist=False,
        )

        assert result is True
        assert future.done()
        assert future.result() == (True, False)


class TestToolExecutorExecution:
    """Test tool execution."""

    @pytest.fixture
    def tmp_workspace(self, tmp_path: Path) -> Path:
        """Create temporary workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        return workspace

    async def test_execute_blocked_in_plan_mode(self, tmp_workspace: Path, mock_tool_categories):
        """Test that writes are blocked in Plan mode."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_PLAN,
        )

        result = await executor.execute(
            tool_name="write_file",
            arguments={"path": "/test.txt", "content": "test"},
        )

        assert "blocked_by_mode" in result
        assert "Plan mode" in result

    async def test_execute_unknown_tool(self, tmp_workspace: Path, mock_tool_categories):
        """Test executing unknown tool."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        result = await executor.execute(
            tool_name="nonexistent_tool",
            arguments={},
        )

        assert "Unknown tool" in result

    async def test_execute_file_tool_without_workspace(self, tmp_workspace: Path, mock_tool_categories):
        """Test file tool fails without workspace configuration."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
            # No workspace_id, so no compute client
        )

        result = await executor.execute(
            tool_name="read_file",
            arguments={"path": "/test.txt"},
        )

        assert "Workspace not configured" in result


class TestToolExecutorDispatch:
    """Test tool dispatch to handlers."""

    @pytest.fixture
    def tmp_workspace(self, tmp_path: Path) -> Path:
        """Create temporary workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        return workspace

    async def test_dispatch_to_file_handler(self, tmp_workspace: Path):
        """Test dispatching file tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        # Without workspace_id, should fail with helpful error
        result = await executor._dispatch_tool("read_file", {"path": "/test.txt"})

        assert result["success"] is False
        assert "Workspace not configured" in result["error"]

    async def test_dispatch_to_git_handler(self, tmp_workspace: Path):
        """Test dispatching git tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        result = await executor._dispatch_tool("git_status", {})

        assert result["success"] is False
        assert "Workspace not configured" in result["error"]

    async def test_dispatch_unknown_tool(self, tmp_workspace: Path):
        """Test dispatching unknown tool."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        result = await executor._dispatch_tool("unknown_tool_xyz", {})

        assert result["success"] is False
        assert "Unknown tool" in result["error"]


class TestToolExecutorMCP:
    """Test MCP tool handling."""

    @pytest.fixture
    def tmp_workspace(self, tmp_path: Path) -> Path:
        """Create temporary workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        return workspace

    async def test_mcp_tool_without_registry(self, tmp_workspace: Path):
        """Test MCP tool execution without registry configured."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
            # No mcp_registry
        )

        result = await executor._handle_mcp_tool(
            "mcp:github:create_issue",
            {"title": "Test issue"},
        )

        assert result["success"] is False
        assert "MCP not configured" in result["error"]

    async def test_mcp_tool_not_found(self, tmp_workspace: Path):
        """Test MCP tool not found in registry."""
        mock_registry = MagicMock()
        mock_registry.get_tool = MagicMock(return_value=None)

        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
            mcp_registry=mock_registry,
        )

        result = await executor._handle_mcp_tool(
            "mcp:github:nonexistent_tool",
            {},
        )

        assert result["success"] is False
        assert "not found" in result["error"]


class TestToolExecutorIntegration:
    """Integration tests for ToolExecutor with mocked compute client."""

    @pytest.fixture
    def tmp_workspace(self, tmp_path: Path) -> Path:
        """Create temporary workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        return workspace

    async def test_read_file_with_compute_client(
        self,
        tmp_workspace: Path,
    ):
        """Test read_file with mocked remote tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
            workspace_id="workspace-abc",
            user_id="user-123",
        )

        # Mock the compute client and remote tools
        mock_client = MagicMock()
        executor._compute_client = mock_client
        executor._compute_client_initialized = True

        with patch("src.tools.executor.remote_tools.read_file", AsyncMock(return_value={"success": True, "content": "hello world"})):
            result = await executor._handle_file_tools("read_file", {"path": "/test.txt"})

        assert result["success"] is True
        assert result["content"] == "hello world"

    async def test_write_file_with_compute_client(
        self,
        tmp_workspace: Path,
    ):
        """Test write_file with mocked remote tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
            workspace_id="workspace-abc",
            user_id="user-123",
        )

        mock_client = MagicMock()
        executor._compute_client = mock_client
        executor._compute_client_initialized = True

        with patch("src.tools.executor.remote_tools.write_file", AsyncMock(return_value={"success": True, "message": "File written"})):
            result = await executor._handle_file_tools(
                "write_file",
                {"path": "/test.txt", "content": "new content"},
            )

        assert result["success"] is True

    async def test_run_command_with_compute_client(
        self,
        tmp_workspace: Path,
    ):
        """Test run_command with mocked remote tools."""
        executor = ToolExecutor(
            workspace_path=tmp_workspace,
            session_id="session-123",
            agent_mode=AGENT_MODE_SOVEREIGN,
            workspace_id="workspace-abc",
            user_id="user-123",
        )

        mock_client = MagicMock()
        executor._compute_client = mock_client
        executor._compute_client_initialized = True

        with patch("src.tools.executor.remote_tools.run_command", AsyncMock(return_value={"success": True, "stdout": "output", "exit_code": 0})):
            result = await executor._handle_file_tools(
                "run_command",
                {"command": "ls -la"},
            )

        assert result["success"] is True
