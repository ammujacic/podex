"""Tests for remote tools module.

Tests cover:
- Remote tool function existence
- File operations via compute client
- Command execution
- Git operations
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

import pytest


class TestRemoteToolsModule:
    """Test remote tools module exists."""

    def test_remote_tools_module_exists(self):
        """Test remote tools module can be imported."""
        from src.tools import remote_tools
        assert remote_tools is not None


class TestRemoteFileOperations:
    """Test remote file operations."""

    def test_read_file_function_exists(self):
        """Test read_file function exists."""
        from src.tools.remote_tools import read_file
        assert read_file is not None
        assert callable(read_file)

    def test_write_file_function_exists(self):
        """Test write_file function exists."""
        from src.tools.remote_tools import write_file
        assert write_file is not None
        assert callable(write_file)

    def test_list_directory_function_exists(self):
        """Test list_directory function exists."""
        from src.tools.remote_tools import list_directory
        assert list_directory is not None
        assert callable(list_directory)


class TestRemoteSearchOperations:
    """Test remote search operations."""

    def test_search_code_function_exists(self):
        """Test search_code function exists."""
        from src.tools.remote_tools import search_code
        assert search_code is not None
        assert callable(search_code)

    def test_glob_files_function_exists(self):
        """Test glob_files function exists."""
        from src.tools.remote_tools import glob_files
        assert glob_files is not None
        assert callable(glob_files)

    def test_grep_function_exists(self):
        """Test grep function exists."""
        from src.tools.remote_tools import grep
        assert grep is not None
        assert callable(grep)


class TestRemoteCommandExecution:
    """Test remote command execution."""

    def test_run_command_function_exists(self):
        """Test run_command function exists."""
        from src.tools.remote_tools import run_command
        assert run_command is not None
        assert callable(run_command)


class TestRemoteGitOperations:
    """Test remote git operations."""

    def test_git_status_function_exists(self):
        """Test git_status function exists."""
        from src.tools.remote_tools import git_status
        assert git_status is not None
        assert callable(git_status)

    def test_git_diff_function_exists(self):
        """Test git_diff function exists."""
        from src.tools.remote_tools import git_diff
        assert git_diff is not None
        assert callable(git_diff)

    def test_git_commit_function_exists(self):
        """Test git_commit function exists."""
        from src.tools.remote_tools import git_commit
        assert git_commit is not None
        assert callable(git_commit)

    def test_git_push_function_exists(self):
        """Test git_push function exists."""
        from src.tools.remote_tools import git_push
        assert git_push is not None
        assert callable(git_push)

    def test_git_log_function_exists(self):
        """Test git_log function exists."""
        from src.tools.remote_tools import git_log
        assert git_log is not None
        assert callable(git_log)

    def test_git_branch_function_exists(self):
        """Test git_branch function exists."""
        from src.tools.remote_tools import git_branch
        assert git_branch is not None
        assert callable(git_branch)


class TestRemoteToolAsync:
    """Test remote tool async operations."""

    @pytest.mark.asyncio
    async def test_read_file_async(self):
        """Test read_file async execution."""
        from src.tools.remote_tools import read_file

        mock_client = AsyncMock()
        mock_client.read_file = AsyncMock(return_value={
            "success": True,
            "content": "file content",
            "path": "test.txt",
        })

        result = await read_file(
            client=mock_client,
            path="test.txt",
        )

        assert result["success"] is True
        assert result["content"] == "file content"

    @pytest.mark.asyncio
    async def test_write_file_async(self):
        """Test write_file async execution."""
        from src.tools.remote_tools import write_file

        mock_client = AsyncMock()
        mock_client.write_file = AsyncMock(return_value={
            "success": True,
            "path": "test.txt",
        })

        result = await write_file(
            client=mock_client,
            path="test.txt",
            content="new content",
        )

        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_list_directory_async(self):
        """Test list_directory async execution."""
        from src.tools.remote_tools import list_directory

        mock_client = AsyncMock()
        mock_client.list_files = AsyncMock(return_value={
            "success": True,
            "entries": [
                {"name": "file1.txt", "type": "file"},
                {"name": "dir1", "type": "directory"},
            ],
        })

        result = await list_directory(
            client=mock_client,
            path=".",
        )

        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_run_command_async(self):
        """Test run_command async execution."""
        from src.tools.remote_tools import run_command

        mock_client = AsyncMock()
        # run_command calls exec_command
        mock_client.exec_command = AsyncMock(return_value={
            "success": True,
            "stdout": "command output",
            "stderr": "",
            "exit_code": 0,
        })

        result = await run_command(
            client=mock_client,
            command="ls -la",
        )

        assert result["success"] is True
        mock_client.exec_command.assert_called_once()

    @pytest.mark.asyncio
    async def test_git_status_async(self):
        """Test git_status async execution."""
        from src.tools.remote_tools import git_status

        mock_client = AsyncMock()
        # git_status calls git_command which returns (success, stdout, stderr)
        mock_client.git_command = AsyncMock(return_value=(True, "## main...origin/main\n M file1.txt", ""))

        result = await git_status(
            client=mock_client,
        )

        assert result["success"] is True
        mock_client.git_command.assert_called_once()


class TestRemoteToolErrorHandling:
    """Test remote tool error handling."""

    @pytest.mark.asyncio
    async def test_read_file_not_found(self):
        """Test read_file with non-existent file."""
        from src.tools.remote_tools import read_file

        mock_client = AsyncMock()
        mock_client.read_file = AsyncMock(return_value={
            "success": False,
            "error": "File not found",
        })

        result = await read_file(
            client=mock_client,
            path="nonexistent.txt",
        )

        assert result["success"] is False
        assert "error" in result

    @pytest.mark.asyncio
    async def test_run_command_failure(self):
        """Test run_command with failure."""
        from src.tools.remote_tools import run_command

        mock_client = AsyncMock()
        # run_command calls exec_command
        mock_client.exec_command = AsyncMock(return_value={
            "success": False,
            "stdout": "",
            "stderr": "command not found",
            "exit_code": 127,
        })

        result = await run_command(
            client=mock_client,
            command="nonexistent_command",
        )

        assert result["success"] is False
        mock_client.exec_command.assert_called_once()


class TestApplyPatch:
    """Test apply_patch functionality."""

    def test_apply_patch_function_exists(self):
        """Test apply_patch function exists."""
        from src.tools.remote_tools import apply_patch
        assert apply_patch is not None
        assert callable(apply_patch)

    @pytest.mark.asyncio
    async def test_apply_patch_async(self):
        """Test apply_patch async execution."""
        from src.tools.remote_tools import apply_patch

        mock_client = AsyncMock()
        # apply_patch reads the file first, then writes the patched content
        mock_client.read_file = AsyncMock(return_value={
            "success": True,
            "content": "old\n",
        })
        mock_client.write_file = AsyncMock(return_value={
            "success": True,
        })

        result = await apply_patch(
            client=mock_client,
            path="file1.txt",
            patch="--- a/file1.txt\n+++ b/file1.txt\n@@ -1 +1 @@\n-old\n+new",
        )

        assert result["success"] is True


class TestCreatePR:
    """Test create_pr functionality."""

    def test_create_pr_function_exists(self):
        """Test create_pr function exists."""
        from src.tools.remote_tools import create_pr
        assert create_pr is not None
        assert callable(create_pr)

    @pytest.mark.asyncio
    async def test_create_pr_async(self):
        """Test create_pr async execution."""
        from src.tools.remote_tools import create_pr

        mock_client = AsyncMock()
        # create_pr uses exec_command to run gh cli
        mock_client.exec_command = AsyncMock(return_value={
            "success": True,
            "stdout": "https://github.com/owner/repo/pull/123",
            "stderr": "",
            "exit_code": 0,
        })

        result = await create_pr(
            client=mock_client,
            title="Test PR",
            body="Test description",
            base="main",
        )

        assert result["success"] is True
        mock_client.exec_command.assert_called_once()


class TestNormalizePath:
    """Test path normalization helper."""

    def test_normalize_path_function_exists(self):
        """Test _normalize_path function exists."""
        from src.tools.remote_tools import _normalize_path
        assert _normalize_path is not None
        assert callable(_normalize_path)

    def test_normalize_path_strips_leading_slash(self):
        """Test _normalize_path strips leading slash."""
        from src.tools.remote_tools import _normalize_path

        assert _normalize_path("/file.txt") == "file.txt"
        assert _normalize_path("/path/to/file.txt") == "path/to/file.txt"

    def test_normalize_path_preserves_relative(self):
        """Test _normalize_path preserves relative paths."""
        from src.tools.remote_tools import _normalize_path

        assert _normalize_path("file.txt") == "file.txt"
        assert _normalize_path("path/to/file.txt") == "path/to/file.txt"

    def test_normalize_path_multiple_slashes(self):
        """Test _normalize_path with multiple leading slashes."""
        from src.tools.remote_tools import _normalize_path

        assert _normalize_path("///file.txt") == "file.txt"


class TestRemoteToolParams:
    """Test remote tool parameter signatures."""

    def test_read_file_params(self):
        """Test read_file parameter signature."""
        from src.tools.remote_tools import read_file
        import inspect

        sig = inspect.signature(read_file)
        params = list(sig.parameters.keys())

        assert "client" in params
        assert "path" in params

    def test_write_file_params(self):
        """Test write_file parameter signature."""
        from src.tools.remote_tools import write_file
        import inspect

        sig = inspect.signature(write_file)
        params = list(sig.parameters.keys())

        assert "client" in params
        assert "path" in params
        assert "content" in params

    def test_run_command_params(self):
        """Test run_command parameter signature."""
        from src.tools.remote_tools import run_command
        import inspect

        sig = inspect.signature(run_command)
        params = list(sig.parameters.keys())

        assert "client" in params
        assert "command" in params


class TestSearchCode:
    """Test search_code functionality."""

    @pytest.mark.asyncio
    async def test_search_code_async(self):
        """Test search_code async execution."""
        from src.tools.remote_tools import search_code

        mock_client = AsyncMock()
        mock_client.search_code = AsyncMock(return_value={
            "success": True,
            "matches": [
                {"file": "src/main.py", "line": 10, "content": "def main():"},
            ],
        })

        result = await search_code(
            client=mock_client,
            query="def main",
        )

        assert result["success"] is True


class TestGlobFiles:
    """Test glob_files functionality."""

    @pytest.mark.asyncio
    async def test_glob_files_async(self):
        """Test glob_files async execution."""
        from src.tools.remote_tools import glob_files

        mock_client = AsyncMock()
        mock_client.glob_files = AsyncMock(return_value={
            "success": True,
            "files": [
                {"path": "src/main.py"},
                {"path": "src/utils.py"},
            ],
        })

        result = await glob_files(
            client=mock_client,
            pattern="*.py",
        )

        assert result["success"] is True
        mock_client.glob_files.assert_called_once()


class TestGitDiff:
    """Test git_diff functionality."""

    @pytest.mark.asyncio
    async def test_git_diff_async(self):
        """Test git_diff async execution."""
        from src.tools.remote_tools import git_diff

        mock_client = AsyncMock()
        # git_diff calls git_command which returns (success, stdout, stderr)
        mock_client.git_command = AsyncMock(return_value=(
            True,
            "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new",
            ""
        ))

        result = await git_diff(
            client=mock_client,
        )

        assert result["success"] is True
        mock_client.git_command.assert_called_once()
