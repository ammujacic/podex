"""Integration tests for tool executor.

Tests cover:
- Tool category loading from Redis
- Approval flow handling
- Command allowlist security
- Tool dispatch and handlers
- Permission checking across modes
"""

import asyncio
import json
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
    _get_command_tools,
    _get_deploy_tools,
    _get_read_tools,
    _get_write_tools,
    _load_tool_categories,
)


class TestToolCategoryLoading:
    """Tests for tool category loading from Redis."""

    @pytest.fixture(autouse=True)
    def reset_cache(self) -> None:
        """Reset the tool categories cache before each test."""
        import src.tools.executor as executor_module

        executor_module._tool_categories_cache = None

    @pytest.mark.asyncio
    async def test_load_tool_categories_from_redis(self) -> None:
        """Test loading tool categories from Redis config."""
        with patch("src.config_reader.get_config_reader") as mock_get_config:
            mock_reader = MagicMock()
            mock_reader.get_tool_categories = AsyncMock(
                return_value={
                    "write_tools": ["write_file", "create_file"],
                    "command_tools": ["run_command"],
                    "read_tools": ["read_file", "list_directory"],
                    "deploy_tools": ["deploy_preview"],
                }
            )
            mock_get_config.return_value = mock_reader

            categories = await _load_tool_categories()

            assert "write_tools" in categories
            assert "write_file" in categories["write_tools"]
            assert "run_command" in categories["command_tools"]

    @pytest.mark.asyncio
    async def test_get_write_tools(self) -> None:
        """Test getting write tools from cache."""
        with patch("src.config_reader.get_config_reader") as mock_get_config:
            mock_reader = MagicMock()
            mock_reader.get_tool_categories = AsyncMock(
                return_value={
                    "write_tools": ["write_file", "apply_patch", "git_commit"],
                    "command_tools": ["run_command"],
                    "read_tools": ["read_file"],
                    "deploy_tools": [],
                }
            )
            mock_get_config.return_value = mock_reader

            write_tools = await _get_write_tools()

            assert "write_file" in write_tools
            assert "apply_patch" in write_tools
            assert "git_commit" in write_tools

    @pytest.mark.asyncio
    async def test_get_command_tools(self) -> None:
        """Test getting command tools from cache."""
        with patch("src.config_reader.get_config_reader") as mock_get_config:
            mock_reader = MagicMock()
            mock_reader.get_tool_categories = AsyncMock(
                return_value={
                    "write_tools": [],
                    "command_tools": ["run_command", "exec_shell"],
                    "read_tools": [],
                    "deploy_tools": [],
                }
            )
            mock_get_config.return_value = mock_reader

            command_tools = await _get_command_tools()

            assert "run_command" in command_tools
            assert "exec_shell" in command_tools

    @pytest.mark.asyncio
    async def test_get_read_tools(self) -> None:
        """Test getting read tools from cache."""
        with patch("src.config_reader.get_config_reader") as mock_get_config:
            mock_reader = MagicMock()
            mock_reader.get_tool_categories = AsyncMock(
                return_value={
                    "write_tools": [],
                    "command_tools": [],
                    "read_tools": ["read_file", "list_directory", "glob_files"],
                    "deploy_tools": [],
                }
            )
            mock_get_config.return_value = mock_reader

            read_tools = await _get_read_tools()

            assert "read_file" in read_tools
            assert "list_directory" in read_tools

    @pytest.mark.asyncio
    async def test_get_deploy_tools(self) -> None:
        """Test getting deploy tools from cache."""
        with patch("src.config_reader.get_config_reader") as mock_get_config:
            mock_reader = MagicMock()
            mock_reader.get_tool_categories = AsyncMock(
                return_value={
                    "write_tools": [],
                    "command_tools": [],
                    "read_tools": [],
                    "deploy_tools": ["deploy_preview", "run_e2e_tests"],
                }
            )
            mock_get_config.return_value = mock_reader

            deploy_tools = await _get_deploy_tools()

            assert "deploy_preview" in deploy_tools
            assert "run_e2e_tests" in deploy_tools

    @pytest.mark.asyncio
    async def test_tool_categories_cached(self) -> None:
        """Test that tool categories are cached after first load."""
        with patch("src.config_reader.get_config_reader") as mock_get_config:
            mock_reader = MagicMock()
            mock_reader.get_tool_categories = AsyncMock(
                return_value={
                    "write_tools": ["write_file"],
                    "command_tools": ["run_command"],
                    "read_tools": ["read_file"],
                    "deploy_tools": [],
                }
            )
            mock_get_config.return_value = mock_reader

            # First call
            await _load_tool_categories()
            # Second call should use cache
            await _load_tool_categories()

            # Config reader should only be called once
            assert mock_reader.get_tool_categories.call_count == 1


class TestCommandAllowlistSecurity:
    """Tests for command allowlist security features."""

    @pytest.fixture
    def executor(self) -> ToolExecutor:
        """Create executor with command allowlist."""
        return ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["npm", "npm install", "python"],
        )

    def test_exact_match_allowed(self, executor: ToolExecutor) -> None:
        """Test exact command match is allowed."""
        assert executor._is_command_allowed("npm") is True
        assert executor._is_command_allowed("python") is True

    def test_prefix_match_allowed(self, executor: ToolExecutor) -> None:
        """Test command prefix match is allowed."""
        assert executor._is_command_allowed("npm install lodash") is True
        assert executor._is_command_allowed("npm install --save lodash") is True

    def test_shell_metacharacters_blocked(self, executor: ToolExecutor) -> None:
        """Test shell metacharacters are blocked even with base match."""
        # These should be blocked due to dangerous characters
        assert executor._is_command_allowed("npm && rm -rf /") is False
        assert executor._is_command_allowed("npm || echo hacked") is False
        assert executor._is_command_allowed("npm; rm -rf /") is False
        assert executor._is_command_allowed("npm | cat /etc/passwd") is False
        assert executor._is_command_allowed("npm `whoami`") is False
        assert executor._is_command_allowed("npm $(cat secret)") is False

    def test_glob_patterns_rejected(self, executor: ToolExecutor) -> None:
        """Test glob patterns in allowlist are rejected."""
        executor.command_allowlist = ["npm*", "python?", "test[123]"]
        # Glob patterns should not match anything
        assert executor._is_command_allowed("npm install") is False
        assert executor._is_command_allowed("python3") is False
        assert executor._is_command_allowed("test1") is False

    def test_empty_command_rejected(self, executor: ToolExecutor) -> None:
        """Test empty commands are rejected."""
        assert executor._is_command_allowed("") is False
        assert executor._is_command_allowed("   ") is False

    def test_no_allowlist_rejects_all(self) -> None:
        """Test that empty allowlist rejects all commands."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=[],
        )
        assert executor._is_command_allowed("npm") is False
        assert executor._is_command_allowed("ls") is False


class TestApprovalFlow:
    """Tests for approval request flow."""

    @pytest.fixture
    def mock_tool_categories(self) -> Any:
        """Mock tool categories for testing."""
        categories = {
            "write_tools": {"write_file", "apply_patch"},
            "command_tools": {"run_command"},
            "read_tools": {"read_file"},
            "deploy_tools": {"deploy_preview"},
        }
        with patch(
            "src.tools.executor._get_write_tools",
            AsyncMock(return_value=categories["write_tools"]),
        ), patch(
            "src.tools.executor._get_command_tools",
            AsyncMock(return_value=categories["command_tools"]),
        ), patch(
            "src.tools.executor._get_read_tools",
            AsyncMock(return_value=categories["read_tools"]),
        ), patch(
            "src.tools.executor._get_deploy_tools",
            AsyncMock(return_value=categories["deploy_tools"]),
        ):
            yield categories

    @pytest.mark.asyncio
    async def test_ask_mode_requires_approval_for_writes(
        self, mock_tool_categories: Any
    ) -> None:
        """Test Ask mode requires approval for write tools."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_ASK,
        )

        permission = await executor._check_permission("write_file", {"path": "/test"})

        assert permission.allowed is True
        assert permission.requires_approval is True

    @pytest.mark.asyncio
    async def test_ask_mode_requires_approval_for_commands(
        self, mock_tool_categories: Any
    ) -> None:
        """Test Ask mode requires approval for command tools."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_ASK,
        )

        permission = await executor._check_permission(
            "run_command", {"command": "npm install"}
        )

        assert permission.allowed is True
        assert permission.requires_approval is True
        assert permission.can_add_to_allowlist is True

    @pytest.mark.asyncio
    async def test_ask_mode_requires_approval_for_deploys(
        self, mock_tool_categories: Any
    ) -> None:
        """Test Ask mode requires approval for deploy tools."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_ASK,
        )

        permission = await executor._check_permission(
            "deploy_preview", {"environment": "staging"}
        )

        assert permission.allowed is True
        assert permission.requires_approval is True

    @pytest.mark.asyncio
    async def test_ask_mode_allows_reads_without_approval(
        self, mock_tool_categories: Any
    ) -> None:
        """Test Ask mode allows read tools without approval."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_ASK,
        )

        permission = await executor._check_permission("read_file", {"path": "/test"})

        assert permission.allowed is True
        assert permission.requires_approval is False

    @pytest.mark.asyncio
    async def test_auto_mode_allows_writes_without_approval(
        self, mock_tool_categories: Any
    ) -> None:
        """Test Auto mode allows write tools without approval."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
        )

        permission = await executor._check_permission("write_file", {"path": "/test"})

        assert permission.allowed is True
        assert permission.requires_approval is False

    @pytest.mark.asyncio
    async def test_auto_mode_requires_approval_for_unlisted_commands(
        self, mock_tool_categories: Any
    ) -> None:
        """Test Auto mode requires approval for commands not in allowlist."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["npm"],
        )

        permission = await executor._check_permission(
            "run_command", {"command": "rm -rf /"}
        )

        assert permission.allowed is True
        assert permission.requires_approval is True
        assert permission.can_add_to_allowlist is True

    @pytest.mark.asyncio
    async def test_auto_mode_allows_listed_commands(
        self, mock_tool_categories: Any
    ) -> None:
        """Test Auto mode allows commands in allowlist without approval."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=["npm install"],
        )

        permission = await executor._check_permission(
            "run_command", {"command": "npm install lodash"}
        )

        assert permission.allowed is True
        assert permission.requires_approval is False

    @pytest.mark.asyncio
    async def test_auto_mode_requires_approval_for_deploys(
        self, mock_tool_categories: Any
    ) -> None:
        """Test Auto mode requires approval for deploy tools."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
        )

        permission = await executor._check_permission(
            "deploy_preview", {"environment": "prod"}
        )

        assert permission.allowed is True
        assert permission.requires_approval is True
        assert permission.can_add_to_allowlist is False

    @pytest.mark.asyncio
    async def test_plan_mode_blocks_writes(self, mock_tool_categories: Any) -> None:
        """Test Plan mode blocks write tools."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        permission = await executor._check_permission("write_file", {"path": "/test"})

        assert permission.allowed is False
        assert "not allowed in Plan mode" in (permission.error or "")

    @pytest.mark.asyncio
    async def test_plan_mode_blocks_commands(self, mock_tool_categories: Any) -> None:
        """Test Plan mode blocks command tools."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        permission = await executor._check_permission(
            "run_command", {"command": "ls"}
        )

        assert permission.allowed is False

    @pytest.mark.asyncio
    async def test_plan_mode_blocks_deploys(self, mock_tool_categories: Any) -> None:
        """Test Plan mode blocks deploy tools."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        permission = await executor._check_permission(
            "deploy_preview", {"environment": "staging"}
        )

        assert permission.allowed is False

    @pytest.mark.asyncio
    async def test_plan_mode_allows_reads(self, mock_tool_categories: Any) -> None:
        """Test Plan mode allows read tools."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        permission = await executor._check_permission("read_file", {"path": "/test"})

        assert permission.allowed is True

    @pytest.mark.asyncio
    async def test_sovereign_mode_allows_all(self, mock_tool_categories: Any) -> None:
        """Test Sovereign mode allows all tools."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        for tool_name in ["write_file", "run_command", "deploy_preview", "read_file"]:
            permission = await executor._check_permission(tool_name, {})
            assert permission.allowed is True
            assert permission.requires_approval is False


class TestToolDispatch:
    """Tests for tool dispatch to handlers."""

    @pytest.fixture
    def mock_tool_categories(self) -> Any:
        """Mock tool categories for testing."""
        categories = {
            "write_tools": {"write_file"},
            "command_tools": {"run_command"},
            "read_tools": {"read_file"},
            "deploy_tools": {"deploy_preview"},
        }
        with patch(
            "src.tools.executor._get_write_tools",
            AsyncMock(return_value=categories["write_tools"]),
        ), patch(
            "src.tools.executor._get_command_tools",
            AsyncMock(return_value=categories["command_tools"]),
        ), patch(
            "src.tools.executor._get_read_tools",
            AsyncMock(return_value=categories["read_tools"]),
        ), patch(
            "src.tools.executor._get_deploy_tools",
            AsyncMock(return_value=categories["deploy_tools"]),
        ):
            yield categories

    @pytest.mark.asyncio
    async def test_dispatch_unknown_tool(self, mock_tool_categories: Any) -> None:
        """Test dispatching unknown tool returns error."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        result = await executor._dispatch_tool("nonexistent_tool", {})

        assert result["success"] is False
        assert "Unknown tool" in result["error"]

    @pytest.mark.asyncio
    async def test_execute_with_permission_denied(
        self, mock_tool_categories: Any
    ) -> None:
        """Test execute returns error when permission denied."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_PLAN,
        )

        result = await executor.execute("write_file", {"path": "/test", "content": "x"})
        result_dict = json.loads(result)

        assert result_dict["success"] is False
        assert result_dict["blocked_by_mode"] is True

    @pytest.mark.asyncio
    async def test_execute_with_approval_denied(
        self, mock_tool_categories: Any
    ) -> None:
        """Test execute returns error when approval denied."""
        # Create approval callback that returns denial
        async def deny_approval(request: dict[str, Any]) -> None:
            pass

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_ASK,
            approval_callback=deny_approval,
        )

        # Mock _request_approval to return denied
        with patch.object(
            executor, "_request_approval", AsyncMock(return_value=(False, False))
        ):
            result = await executor.execute(
                "write_file", {"path": "/test", "content": "x"}
            )
            result_dict = json.loads(result)

            assert result_dict["success"] is False
            assert result_dict["requires_approval"] is True

    @pytest.mark.asyncio
    async def test_execute_memory_tool(self, mock_tool_categories: Any) -> None:
        """Test executing memory tool dispatches to handler."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        with patch.object(
            executor,
            "_handle_memory_tools",
            AsyncMock(return_value={"success": True}),
        ) as mock_handler:
            result = await executor._dispatch_tool(
                "store_memory",
                {"content": "test memory", "memory_type": "fact"},
            )

            assert result["success"] is True
            mock_handler.assert_called_once_with(
                "store_memory", {"content": "test memory", "memory_type": "fact"}
            )

    @pytest.mark.asyncio
    async def test_execute_skill_tool(self, mock_tool_categories: Any) -> None:
        """Test executing skill tool dispatches to handler."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        with patch.object(
            executor,
            "_handle_skill_tools",
            AsyncMock(return_value={"success": True, "skills": []}),
        ) as mock_handler:
            result = await executor._dispatch_tool("list_skills", {})

            assert result["success"] is True
            mock_handler.assert_called_once_with("list_skills", {})

    @pytest.mark.asyncio
    async def test_execute_orchestrator_tool(self, mock_tool_categories: Any) -> None:
        """Test executing orchestrator tool dispatches to handler."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        with patch.object(
            executor,
            "_handle_orchestrator_tools",
            AsyncMock(return_value={"success": True, "subagents": []}),
        ) as mock_handler:
            result = await executor._dispatch_tool(
                "get_active_subagents", {"parent_agent_id": "agent-456"}
            )

            assert result["success"] is True
            mock_handler.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_health_tool(self, mock_tool_categories: Any) -> None:
        """Test executing health tool dispatches to handler."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        with patch.object(
            executor,
            "_handle_health_tools",
            AsyncMock(return_value={"success": True, "checks": []}),
        ) as mock_handler:
            result = await executor._dispatch_tool("list_health_checks", {})

            assert result["success"] is True
            mock_handler.assert_called_once_with("list_health_checks", {})

    @pytest.mark.asyncio
    async def test_execute_web_tool(self, mock_tool_categories: Any) -> None:
        """Test executing web tool dispatches to handler."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
        )

        with patch.object(
            executor,
            "_handle_web_tools",
            AsyncMock(return_value={"success": True, "results": []}),
        ) as mock_handler:
            result = await executor._dispatch_tool(
                "search_web", {"query": "test search"}
            )

            assert result["success"] is True
            mock_handler.assert_called_once_with("search_web", {"query": "test search"})


class TestMCPToolHandling:
    """Tests for MCP tool handling."""

    @pytest.fixture
    def mock_tool_categories(self) -> Any:
        """Mock tool categories for testing."""
        categories = {
            "write_tools": set(),
            "command_tools": set(),
            "read_tools": set(),
            "deploy_tools": set(),
        }
        with patch(
            "src.tools.executor._get_write_tools",
            AsyncMock(return_value=categories["write_tools"]),
        ), patch(
            "src.tools.executor._get_command_tools",
            AsyncMock(return_value=categories["command_tools"]),
        ), patch(
            "src.tools.executor._get_read_tools",
            AsyncMock(return_value=categories["read_tools"]),
        ), patch(
            "src.tools.executor._get_deploy_tools",
            AsyncMock(return_value=categories["deploy_tools"]),
        ):
            yield categories

    @pytest.mark.asyncio
    async def test_dispatch_mcp_tool_format(self, mock_tool_categories: Any) -> None:
        """Test dispatching MCP tool calls handler method."""
        mock_registry = MagicMock()

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
            mcp_registry=mock_registry,
        )

        # Mock the MCP handler method
        with patch.object(
            executor,
            "_handle_mcp_tool",
            AsyncMock(return_value={"success": True, "data": "mcp result"}),
        ) as mock_handler:
            # MCP tools have format "mcp:server:tool"
            with patch(
                "src.tools.executor.is_mcp_tool_name", return_value=True
            ):
                result = await executor._dispatch_tool(
                    "mcp:test-server:test-tool", {"param": "value"}
                )

                assert result["success"] is True
                mock_handler.assert_called_once_with(
                    "mcp:test-server:test-tool", {"param": "value"}
                )

    @pytest.mark.asyncio
    async def test_mcp_tool_without_registry(self, mock_tool_categories: Any) -> None:
        """Test MCP tool execution without registry returns error."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_SOVEREIGN,
            mcp_registry=None,
        )

        # Use the actual _handle_mcp_tool method with no registry
        with patch("src.tools.executor.is_mcp_tool_name", return_value=True):
            result = await executor._dispatch_tool(
                "mcp:test-server:test-tool", {"param": "value"}
            )

            assert result["success"] is False
            assert "MCP" in result.get("error", "") or "registry" in result.get("error", "").lower()


class TestApprovalTracking:
    """Tests for approval request tracking."""

    @pytest.fixture
    def mock_tool_categories(self) -> Any:
        """Mock tool categories for testing."""
        categories = {
            "write_tools": {"write_file"},
            "command_tools": {"run_command"},
            "read_tools": {"read_file"},
            "deploy_tools": set(),
        }
        with patch(
            "src.tools.executor._get_write_tools",
            AsyncMock(return_value=categories["write_tools"]),
        ), patch(
            "src.tools.executor._get_command_tools",
            AsyncMock(return_value=categories["command_tools"]),
        ), patch(
            "src.tools.executor._get_read_tools",
            AsyncMock(return_value=categories["read_tools"]),
        ), patch(
            "src.tools.executor._get_deploy_tools",
            AsyncMock(return_value=categories["deploy_tools"]),
        ):
            yield categories

    @pytest.mark.asyncio
    async def test_approval_adds_command_to_allowlist(
        self, mock_tool_categories: Any
    ) -> None:
        """Test that approved commands can be added to allowlist."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=[],
        )

        # Mock _request_approval to return approved with add_to_allowlist
        with patch.object(
            executor, "_request_approval", AsyncMock(return_value=(True, True))
        ), patch.object(
            executor, "_dispatch_tool", AsyncMock(return_value={"success": True})
        ):
            await executor.execute("run_command", {"command": "npm install"})

            # Command should be added to allowlist
            assert "npm install" in executor.command_allowlist

    @pytest.mark.asyncio
    async def test_approval_without_adding_to_allowlist(
        self, mock_tool_categories: Any
    ) -> None:
        """Test approval without adding to allowlist."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            agent_mode=AGENT_MODE_AUTO,
            command_allowlist=[],
        )

        # Mock _request_approval to return approved without add_to_allowlist
        with patch.object(
            executor, "_request_approval", AsyncMock(return_value=(True, False))
        ), patch.object(
            executor, "_dispatch_tool", AsyncMock(return_value={"success": True})
        ):
            await executor.execute("run_command", {"command": "npm install"})

            # Command should NOT be added to allowlist
            assert "npm install" not in executor.command_allowlist


class TestPermissionResultDataclass:
    """Tests for PermissionResult dataclass."""

    def test_permission_result_defaults(self) -> None:
        """Test PermissionResult default values."""
        result = PermissionResult(allowed=True)

        assert result.allowed is True
        assert result.error is None
        assert result.requires_approval is False
        assert result.can_add_to_allowlist is False

    def test_permission_result_with_error(self) -> None:
        """Test PermissionResult with error."""
        result = PermissionResult(
            allowed=False,
            error="Tool blocked in Plan mode",
        )

        assert result.allowed is False
        assert result.error == "Tool blocked in Plan mode"

    def test_permission_result_requires_approval(self) -> None:
        """Test PermissionResult requiring approval."""
        result = PermissionResult(
            allowed=True,
            requires_approval=True,
            can_add_to_allowlist=True,
        )

        assert result.allowed is True
        assert result.requires_approval is True
        assert result.can_add_to_allowlist is True


class TestComputeClientIntegration:
    """Tests for compute client integration."""

    @pytest.mark.asyncio
    async def test_get_compute_client_lazy_init(self) -> None:
        """Test compute client is lazily initialized."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            user_id="user-123",
            workspace_id="workspace-789",
        )

        assert executor._compute_client is None
        assert executor._compute_client_initialized is False

    @pytest.mark.asyncio
    async def test_get_compute_client_without_workspace_id(self) -> None:
        """Test get_compute_client returns None without workspace_id."""
        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
        )

        client = await executor._get_compute_client()

        assert client is None
        assert executor._compute_client_initialized is True

    @pytest.mark.asyncio
    async def test_get_compute_client_url_not_found(self) -> None:
        """Test get_compute_client handles URL not found error."""
        from src.compute_client import ComputeServiceURLNotFoundError

        executor = ToolExecutor(
            workspace_path="/tmp/workspace",
            session_id="session-123",
            agent_id="agent-456",
            user_id="user-123",
            workspace_id="workspace-789",
        )

        with patch(
            "src.compute_client.get_compute_client",
            AsyncMock(
                side_effect=ComputeServiceURLNotFoundError("workspace-789", "user-123")
            ),
        ):
            with pytest.raises(ComputeServiceURLNotFoundError):
                await executor._get_compute_client()
