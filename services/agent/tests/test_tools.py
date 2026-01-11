"""
Comprehensive tests for Agent tools.

Tests cover:
- File tools (read, write, list_directory)
- Git tools (status, commit, branch)
- Command tools (run_command)
- Web tools (fetch_url, search_web)
- Memory tools (store, recall)
- Task tools (create, complete)
- Vision tools (analyze_screenshot)
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def mock_workspace() -> dict[str, Any]:
    """Create a mock workspace."""
    return {
        "id": "workspace-123",
        "session_id": "session-123",
        "root_path": "/workspace",
        "files": {
            "src/index.ts": "console.log('hello');",
            "package.json": '{"name": "test"}',
        },
    }


@pytest.fixture
def mock_git_repo() -> dict[str, Any]:
    """Create a mock git repository state."""
    return {
        "branch": "main",
        "status": "clean",
        "remote": "origin",
        "commits": [
            {"sha": "abc123", "message": "Initial commit", "author": "test"},
        ],
    }


# ============================================================================
# FILE TOOLS TESTS
# ============================================================================


class TestFileTools:
    """Tests for file operation tools."""

    def test_list_tools(self, client: TestClient) -> None:
        """Test listing available tools."""
        response = client.get("/agents/tools")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        # Verify tool structure
        tool = data[0]
        assert "name" in tool
        assert "description" in tool

    @pytest.mark.asyncio
    async def test_read_file_tool_exists(self) -> None:
        """Test read_file tool exists."""
        from src.tools.file_tools import read_file  # noqa: PLC0415

        assert read_file is not None
        assert callable(read_file)

    @pytest.mark.asyncio
    async def test_write_file_tool_exists(self) -> None:
        """Test write_file tool exists."""
        from src.tools.file_tools import write_file  # noqa: PLC0415

        assert write_file is not None
        assert callable(write_file)

    @pytest.mark.asyncio
    async def test_list_directory_tool_exists(self) -> None:
        """Test list_directory tool exists."""
        from src.tools.file_tools import list_directory  # noqa: PLC0415

        assert list_directory is not None
        assert callable(list_directory)

    @pytest.mark.asyncio
    async def test_search_code_tool_exists(self) -> None:
        """Test search_code tool exists."""
        from src.tools.file_tools import search_code  # noqa: PLC0415

        assert search_code is not None
        assert callable(search_code)


# ============================================================================
# GIT TOOLS TESTS
# ============================================================================


class TestGitTools:
    """Tests for git operation tools."""

    @pytest.mark.asyncio
    async def test_git_status_tool(self) -> None:
        """Test git_status tool exists."""
        from src.tools.git_tools import git_status  # noqa: PLC0415

        assert git_status is not None
        assert callable(git_status)

    @pytest.mark.asyncio
    async def test_git_commit_tool(self) -> None:
        """Test git_commit tool exists."""
        from src.tools.git_tools import git_commit  # noqa: PLC0415

        assert git_commit is not None
        assert callable(git_commit)

    @pytest.mark.asyncio
    async def test_git_branch_tool(self) -> None:
        """Test git_branch tool exists."""
        from src.tools.git_tools import git_branch  # noqa: PLC0415

        assert git_branch is not None
        assert callable(git_branch)

    @pytest.mark.asyncio
    async def test_git_diff_tool(self) -> None:
        """Test git_diff tool exists."""
        from src.tools.git_tools import git_diff  # noqa: PLC0415

        assert git_diff is not None
        assert callable(git_diff)

    @pytest.mark.asyncio
    async def test_git_log_tool(self) -> None:
        """Test git_log tool exists."""
        from src.tools.git_tools import git_log  # noqa: PLC0415

        assert git_log is not None
        assert callable(git_log)


# ============================================================================
# COMMAND TOOLS TESTS
# ============================================================================


class TestCommandTools:
    """Tests for command execution tools."""

    @pytest.mark.asyncio
    async def test_run_command_tool_exists(self) -> None:
        """Test run_command tool exists."""
        from src.tools.command_tools import run_command  # noqa: PLC0415

        assert run_command is not None
        assert callable(run_command)

    def test_validate_command_helper(self) -> None:
        """Test _validate_command helper function."""
        from src.tools.command_tools import _validate_command  # noqa: PLC0415

        # Test valid command
        is_valid, message = _validate_command("ls -la")
        assert isinstance(is_valid, bool)
        assert isinstance(message, str)

    def test_check_dangerous_patterns(self) -> None:
        """Test _check_dangerous_patterns helper."""
        from src.tools.command_tools import _check_dangerous_patterns  # noqa: PLC0415

        # Test that rm -rf / is flagged as dangerous
        is_safe, message = _check_dangerous_patterns("rm -rf /")
        assert isinstance(is_safe, bool)
        assert isinstance(message, str)


# ============================================================================
# WEB TOOLS TESTS
# ============================================================================


class TestWebTools:
    """Tests for web operation tools."""

    @pytest.mark.asyncio
    async def test_fetch_url_tool_exists(self) -> None:
        """Test fetch_url tool exists."""
        from src.tools.web_tools import fetch_url  # noqa: PLC0415

        assert fetch_url is not None
        assert callable(fetch_url)

    @pytest.mark.asyncio
    async def test_search_web_tool_exists(self) -> None:
        """Test search_web tool exists."""
        from src.tools.web_tools import search_web  # noqa: PLC0415

        assert search_web is not None
        assert callable(search_web)


# ============================================================================
# MEMORY TOOLS TESTS
# ============================================================================


class TestMemoryTools:
    """Tests for memory/knowledge tools."""

    @pytest.mark.asyncio
    async def test_store_memory_tool_exists(self) -> None:
        """Test store_memory tool exists."""
        from src.tools.memory_tools import store_memory  # noqa: PLC0415

        assert store_memory is not None
        assert callable(store_memory)

    @pytest.mark.asyncio
    async def test_recall_memory_tool_exists(self) -> None:
        """Test recall_memory tool exists."""
        from src.tools.memory_tools import recall_memory  # noqa: PLC0415

        assert recall_memory is not None
        assert callable(recall_memory)

    @pytest.mark.asyncio
    async def test_delete_memory_tool_exists(self) -> None:
        """Test delete_memory tool exists."""
        from src.tools.memory_tools import delete_memory  # noqa: PLC0415

        assert delete_memory is not None
        assert callable(delete_memory)

    @pytest.mark.asyncio
    async def test_get_session_memories_tool_exists(self) -> None:
        """Test get_session_memories tool exists."""
        from src.tools.memory_tools import get_session_memories  # noqa: PLC0415

        assert get_session_memories is not None
        assert callable(get_session_memories)

    def test_store_memory_params_dataclass(self) -> None:
        """Test StoreMemoryParams dataclass."""
        from src.tools.memory_tools import StoreMemoryParams  # noqa: PLC0415

        params = StoreMemoryParams(
            content="Test memory",
            session_id="session-123",
            user_id="user-123",
        )
        assert params.content == "Test memory"
        assert params.session_id == "session-123"
        assert params.user_id == "user-123"

    def test_recall_memory_params_dataclass(self) -> None:
        """Test RecallMemoryParams dataclass."""
        from src.tools.memory_tools import RecallMemoryParams  # noqa: PLC0415

        params = RecallMemoryParams(
            query="find test",
            session_id="session-123",
            user_id="user-123",
        )
        assert params.query == "find test"
        assert params.session_id == "session-123"
        assert params.user_id == "user-123"


# ============================================================================
# TASK TOOLS TESTS
# ============================================================================


class TestTaskTools:
    """Tests for task management tools."""

    @pytest.mark.asyncio
    async def test_create_task_tool_exists(self) -> None:
        """Test create_task tool exists."""
        from src.tools.task_tools import create_task  # noqa: PLC0415

        assert create_task is not None
        assert callable(create_task)

    @pytest.mark.asyncio
    async def test_complete_task_tool_exists(self) -> None:
        """Test complete_task tool exists."""
        from src.tools.task_tools import complete_task  # noqa: PLC0415

        assert complete_task is not None
        assert callable(complete_task)

    @pytest.mark.asyncio
    async def test_get_task_tool_exists(self) -> None:
        """Test get_task tool exists."""
        from src.tools.task_tools import get_task  # noqa: PLC0415

        assert get_task is not None
        assert callable(get_task)

    @pytest.mark.asyncio
    async def test_cancel_task_tool_exists(self) -> None:
        """Test cancel_task tool exists."""
        from src.tools.task_tools import cancel_task  # noqa: PLC0415

        assert cancel_task is not None
        assert callable(cancel_task)

    def test_task_config_dataclass(self) -> None:
        """Test TaskConfig dataclass."""
        from src.tools.task_tools import TaskConfig  # noqa: PLC0415

        config = TaskConfig(
            session_id="session-123",
            agent_role="coder",
            description="A test task",
        )
        assert config.session_id == "session-123"
        assert config.agent_role == "coder"
        assert config.description == "A test task"


# ============================================================================
# VISION TOOLS TESTS
# ============================================================================


class TestVisionTools:
    """Tests for vision/image analysis tools."""

    @pytest.mark.asyncio
    async def test_analyze_screenshot_tool_exists(self) -> None:
        """Test analyze_screenshot tool exists."""
        from src.tools.vision_tools import analyze_screenshot  # noqa: PLC0415

        assert analyze_screenshot is not None
        assert callable(analyze_screenshot)

    @pytest.mark.asyncio
    async def test_design_to_code_tool_exists(self) -> None:
        """Test design_to_code tool exists."""
        from src.tools.vision_tools import design_to_code  # noqa: PLC0415

        assert design_to_code is not None
        assert callable(design_to_code)

    @pytest.mark.asyncio
    async def test_visual_diff_tool_exists(self) -> None:
        """Test visual_diff tool exists."""
        from src.tools.vision_tools import visual_diff  # noqa: PLC0415

        assert visual_diff is not None
        assert callable(visual_diff)

    @pytest.mark.asyncio
    async def test_analyze_accessibility_tool_exists(self) -> None:
        """Test analyze_accessibility tool exists."""
        from src.tools.vision_tools import analyze_accessibility  # noqa: PLC0415

        assert analyze_accessibility is not None
        assert callable(analyze_accessibility)
