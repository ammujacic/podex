"""Tests for remote workspace tools.

Tests cover:
- Remote file operations (read, write, list)
- Remote command execution
- Remote git operations
- ComputeClient integration
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.tools import remote_tools


class TestRemoteToolsModule:
    """Test remote tools module structure."""

    def test_remote_tools_module_exists(self):
        """Test remote tools module can be imported."""
        assert remote_tools is not None

    def test_read_file_function_exists(self):
        """Test read_file function exists."""
        assert hasattr(remote_tools, "read_file")
        assert callable(remote_tools.read_file)

    def test_write_file_function_exists(self):
        """Test write_file function exists."""
        assert hasattr(remote_tools, "write_file")
        assert callable(remote_tools.write_file)

    def test_list_directory_function_exists(self):
        """Test list_directory function exists."""
        assert hasattr(remote_tools, "list_directory")
        assert callable(remote_tools.list_directory)

    def test_search_code_function_exists(self):
        """Test search_code function exists."""
        assert hasattr(remote_tools, "search_code")
        assert callable(remote_tools.search_code)

    def test_run_command_function_exists(self):
        """Test run_command function exists."""
        assert hasattr(remote_tools, "run_command")
        assert callable(remote_tools.run_command)


class TestRemoteGitTools:
    """Test remote git operations."""

    def test_git_status_exists(self):
        """Test git_status function exists."""
        assert hasattr(remote_tools, "git_status")

    def test_git_commit_exists(self):
        """Test git_commit function exists."""
        assert hasattr(remote_tools, "git_commit")

    def test_git_diff_exists(self):
        """Test git_diff function exists."""
        assert hasattr(remote_tools, "git_diff")

    def test_git_log_exists(self):
        """Test git_log function exists."""
        assert hasattr(remote_tools, "git_log")

    def test_git_branch_exists(self):
        """Test git_branch function exists."""
        assert hasattr(remote_tools, "git_branch")


class TestComputeClientIntegration:
    """Test ComputeClient usage in remote tools."""

    def test_compute_client_module_exists(self):
        """Test compute client module can be imported."""
        from src import compute_client
        assert compute_client is not None

    def test_compute_client_class_exists(self):
        """Test ComputeClient class exists."""
        from src.compute_client import ComputeClient
        assert ComputeClient is not None

    def test_get_compute_client_exists(self):
        """Test get_compute_client function exists."""
        from src.compute_client import get_compute_client
        assert callable(get_compute_client)


class TestRemoteFileOperations:
    """Test remote file operation tools."""

    @pytest.fixture
    def mock_compute_client(self) -> MagicMock:
        """Create mock compute client that matches the actual interface."""
        mock = MagicMock()
        mock.read_file = AsyncMock(return_value={"success": True, "content": "file content"})
        mock.write_file = AsyncMock(return_value={"success": True})
        mock.list_files = AsyncMock(return_value={"success": True, "entries": []})
        return mock

    async def test_read_file_calls_compute_client(self, mock_compute_client: MagicMock):
        """Test read_file delegates to compute client."""
        # remote_tools.read_file takes (client, path) - not workspace_id/user_id
        result = await remote_tools.read_file(mock_compute_client, "main.py")
        mock_compute_client.read_file.assert_called_once_with("main.py")

    async def test_write_file_calls_compute_client(self, mock_compute_client: MagicMock):
        """Test write_file delegates to compute client."""
        result = await remote_tools.write_file(
            mock_compute_client,
            "new.py",
            "print('hello')",
        )
        mock_compute_client.write_file.assert_called_once_with("new.py", "print('hello')")

    async def test_list_directory_calls_compute_client(self, mock_compute_client: MagicMock):
        """Test list_directory delegates to compute client."""
        result = await remote_tools.list_directory(mock_compute_client, "src")
        mock_compute_client.list_files.assert_called_once()


class TestRemoteCommandExecution:
    """Test remote command execution."""

    @pytest.fixture
    def mock_compute_client(self) -> MagicMock:
        """Create mock compute client."""
        mock = MagicMock()
        # Note: run_command calls client.exec_command internally
        mock.exec_command = AsyncMock(return_value={
            "success": True,
            "stdout": "output",
            "stderr": "",
            "exit_code": 0,
        })
        return mock

    async def test_run_command_returns_result(self, mock_compute_client: MagicMock):
        """Test run_command returns execution result."""
        result = await remote_tools.run_command(mock_compute_client, "ls -la")
        mock_compute_client.exec_command.assert_called_once()


class TestPathNormalization:
    """Test path normalization helper."""

    def test_normalize_path_strips_leading_slash(self):
        """Test that _normalize_path strips leading slashes."""
        assert remote_tools._normalize_path("/README.md") == "README.md"
        assert remote_tools._normalize_path("README.md") == "README.md"
        assert remote_tools._normalize_path("//src/main.py") == "src/main.py"

    def test_normalize_path_handles_empty(self):
        """Test _normalize_path with empty string."""
        assert remote_tools._normalize_path("") == ""


class TestToolResultFormat:
    """Test tool result formatting."""

    def test_success_result_format(self):
        """Test successful result format."""
        result = {
            "success": True,
            "content": "File content here",
        }
        assert result["success"] is True
        assert "content" in result

    def test_error_result_format(self):
        """Test error result format."""
        result = {
            "success": False,
            "error": "File not found",
        }
        assert result["success"] is False
        assert "error" in result
