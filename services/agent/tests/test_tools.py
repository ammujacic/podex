"""
Comprehensive tests for Agent tools.

Tests cover:
- Remote tools (read_file, write_file, run_command, git operations via ComputeClient)
- Web tools (fetch_url, search_web)
- Memory tools (store, recall)
- Task tools (create, complete)
- Vision tools (analyze_screenshot)

NOTE: File, command, and git tools now execute remotely on workspace containers
via the ComputeClient. Tests for these require mocking the ComputeClient.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest

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


@pytest.fixture
def mock_compute_client() -> AsyncMock:
    """Create a mock ComputeClient."""
    client = AsyncMock()
    client.workspace_id = "workspace-123"
    client.user_id = "user-123"
    return client


# ============================================================================
# REMOTE FILE TOOLS TESTS
# ============================================================================


class TestRemoteFileTools:
    """Tests for remote file operation tools via ComputeClient."""

    @pytest.mark.asyncio
    async def test_read_file_tool_exists(self) -> None:
        """Test read_file tool exists."""
        from src.tools.remote_tools import read_file

        assert read_file is not None
        assert callable(read_file)

    @pytest.mark.asyncio
    async def test_write_file_tool_exists(self) -> None:
        """Test write_file tool exists."""
        from src.tools.remote_tools import write_file

        assert write_file is not None
        assert callable(write_file)

    @pytest.mark.asyncio
    async def test_list_directory_tool_exists(self) -> None:
        """Test list_directory tool exists."""
        from src.tools.remote_tools import list_directory

        assert list_directory is not None
        assert callable(list_directory)

    @pytest.mark.asyncio
    async def test_search_code_tool_exists(self) -> None:
        """Test search_code tool exists."""
        from src.tools.remote_tools import search_code

        assert search_code is not None
        assert callable(search_code)

    @pytest.mark.asyncio
    async def test_run_command_tool_exists(self) -> None:
        """Test run_command tool exists."""
        from src.tools.remote_tools import run_command

        assert run_command is not None
        assert callable(run_command)

    @pytest.mark.asyncio
    async def test_read_file_with_mock_client(self, mock_compute_client: AsyncMock) -> None:
        """Test read_file calls ComputeClient correctly."""
        from src.tools.remote_tools import read_file

        mock_compute_client.read_file.return_value = {
            "success": True,
            "content": "file content",
            "path": "test.txt",
        }

        result = await read_file(mock_compute_client, "test.txt")

        assert result["success"] is True
        assert result["content"] == "file content"
        mock_compute_client.read_file.assert_called_once_with("test.txt")


# ============================================================================
# REMOTE GIT TOOLS TESTS
# ============================================================================


class TestRemoteGitTools:
    """Tests for remote git operation tools via ComputeClient."""

    @pytest.mark.asyncio
    async def test_git_status_tool_exists(self) -> None:
        """Test git_status tool exists."""
        from src.tools.remote_tools import git_status

        assert git_status is not None
        assert callable(git_status)

    @pytest.mark.asyncio
    async def test_git_commit_tool_exists(self) -> None:
        """Test git_commit tool exists."""
        from src.tools.remote_tools import git_commit

        assert git_commit is not None
        assert callable(git_commit)

    @pytest.mark.asyncio
    async def test_git_branch_tool_exists(self) -> None:
        """Test git_branch tool exists."""
        from src.tools.remote_tools import git_branch

        assert git_branch is not None
        assert callable(git_branch)

    @pytest.mark.asyncio
    async def test_git_diff_tool_exists(self) -> None:
        """Test git_diff tool exists."""
        from src.tools.remote_tools import git_diff

        assert git_diff is not None
        assert callable(git_diff)

    @pytest.mark.asyncio
    async def test_git_log_tool_exists(self) -> None:
        """Test git_log tool exists."""
        from src.tools.remote_tools import git_log

        assert git_log is not None
        assert callable(git_log)

    @pytest.mark.asyncio
    async def test_git_status_with_mock_client(self, mock_compute_client: AsyncMock) -> None:
        """Test git_status calls ComputeClient correctly."""
        from src.tools.remote_tools import git_status

        mock_compute_client.git_command.return_value = (True, "## main\n", "")

        result = await git_status(mock_compute_client)

        assert result["success"] is True
        mock_compute_client.git_command.assert_called_once()


# ============================================================================
# WEB TOOLS TESTS
# ============================================================================


class TestWebTools:
    """Tests for web operation tools."""

    @pytest.mark.asyncio
    async def test_fetch_url_tool_exists(self) -> None:
        """Test fetch_url tool exists."""
        from src.tools.web_tools import fetch_url

        assert fetch_url is not None
        assert callable(fetch_url)

    @pytest.mark.asyncio
    async def test_search_web_tool_exists(self) -> None:
        """Test search_web tool exists."""
        from src.tools.web_tools import search_web

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
        from src.tools.memory_tools import store_memory

        assert store_memory is not None
        assert callable(store_memory)

    @pytest.mark.asyncio
    async def test_recall_memory_tool_exists(self) -> None:
        """Test recall_memory tool exists."""
        from src.tools.memory_tools import recall_memory

        assert recall_memory is not None
        assert callable(recall_memory)

    @pytest.mark.asyncio
    async def test_delete_memory_tool_exists(self) -> None:
        """Test delete_memory tool exists."""
        from src.tools.memory_tools import delete_memory

        assert delete_memory is not None
        assert callable(delete_memory)

    @pytest.mark.asyncio
    async def test_get_session_memories_tool_exists(self) -> None:
        """Test get_session_memories tool exists."""
        from src.tools.memory_tools import get_session_memories

        assert get_session_memories is not None
        assert callable(get_session_memories)

    def test_store_memory_params_dataclass(self) -> None:
        """Test StoreMemoryParams dataclass."""
        from src.tools.memory_tools import StoreMemoryParams

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
        from src.tools.memory_tools import RecallMemoryParams

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
        from src.tools.task_tools import create_task

        assert create_task is not None
        assert callable(create_task)

    @pytest.mark.asyncio
    async def test_complete_task_tool_exists(self) -> None:
        """Test complete_task tool exists."""
        from src.tools.task_tools import complete_task

        assert complete_task is not None
        assert callable(complete_task)

    @pytest.mark.asyncio
    async def test_get_task_tool_exists(self) -> None:
        """Test get_task tool exists."""
        from src.tools.task_tools import get_task

        assert get_task is not None
        assert callable(get_task)

    @pytest.mark.asyncio
    async def test_cancel_task_tool_exists(self) -> None:
        """Test cancel_task tool exists."""
        from src.tools.task_tools import cancel_task

        assert cancel_task is not None
        assert callable(cancel_task)

    def test_task_config_dataclass(self) -> None:
        """Test TaskConfig dataclass."""
        from src.tools.task_tools import TaskConfig

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
        from src.tools.vision_tools import analyze_screenshot

        assert analyze_screenshot is not None
        assert callable(analyze_screenshot)

    @pytest.mark.asyncio
    async def test_design_to_code_tool_exists(self) -> None:
        """Test design_to_code tool exists."""
        from src.tools.vision_tools import design_to_code

        assert design_to_code is not None
        assert callable(design_to_code)

    @pytest.mark.asyncio
    async def test_visual_diff_tool_exists(self) -> None:
        """Test visual_diff tool exists."""
        from src.tools.vision_tools import visual_diff

        assert visual_diff is not None
        assert callable(visual_diff)

    @pytest.mark.asyncio
    async def test_analyze_accessibility_tool_exists(self) -> None:
        """Test analyze_accessibility tool exists."""
        from src.tools.vision_tools import analyze_accessibility

        assert analyze_accessibility is not None
        assert callable(analyze_accessibility)


# ============================================================================
# COMPUTE CLIENT TESTS
# ============================================================================


class TestComputeClient:
    """Tests for ComputeClient."""

    def test_compute_client_exists(self) -> None:
        """Test ComputeClient class exists."""
        from src.compute_client import ComputeClient

        assert ComputeClient is not None

    def test_get_compute_client_exists(self) -> None:
        """Test get_compute_client function exists."""
        from src.compute_client import get_compute_client

        assert get_compute_client is not None
        assert callable(get_compute_client)

    def test_create_compute_client(self) -> None:
        """Test creating a ComputeClient instance."""
        from src.compute_client import ComputeClient

        client = ComputeClient(
            workspace_id="workspace-123",
            user_id="user-123",
            base_url="http://localhost:3003",
        )
        assert client.workspace_id == "workspace-123"
        assert client.user_id == "user-123"
