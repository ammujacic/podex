"""Comprehensive tests for ComputeClient.

Tests workspace operations via compute service:
- File operations (read, write, list)
- Command execution (exec_command)
- Git operations (git_command)
- Search operations (grep, glob_files, search_code)
- Error handling and timeouts
- Health checks
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.compute_client import (
    ComputeClient,
    ComputeClientError,
    _get_service_auth,
    get_compute_client,
    clear_client_cache,
)


class TestComputeClientInitialization:
    """Test ComputeClient initialization."""

    def test_basic_initialization(self) -> None:
        """Test basic client initialization with required base_url."""
        client = ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

        assert client.workspace_id == "workspace-123"
        assert client.user_id == "user-456"
        assert client.base_url == "http://compute:8000"

    def test_initialization_with_custom_base_url(self) -> None:
        """Test client initialization with custom base URL."""
        client = ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://custom-compute:8000",
        )

        assert client.base_url == "http://custom-compute:8000"

    def test_initialization_with_auth_token(self) -> None:
        """Test client initialization with custom auth token."""
        client = ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
            auth_token="custom-token",
        )

        assert client.auth_token == "custom-token"

    def test_base_url_strips_trailing_slash(self) -> None:
        """Test that trailing slash is stripped from base URL."""
        client = ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000/",
        )

        assert client.base_url == "http://compute:8000"


class TestComputeClientHeaders:
    """Test header generation for requests."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
            auth_token="test-token",
        )

    async def test_get_headers_includes_user_id(self, client: ComputeClient) -> None:
        """Test that headers include X-User-ID."""
        with patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            headers = await client._get_headers()

        assert headers["X-User-ID"] == "user-456"
        assert headers["Content-Type"] == "application/json"
        # Verify _get_service_auth was called with the compute URL
        mock_auth.assert_called_with("http://compute:8000")

    async def test_get_headers_includes_auth_headers(self, client: ComputeClient) -> None:
        """Test that headers include auth headers from service auth."""
        with patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(
                return_value={"Authorization": "Bearer test-jwt"}
            )
            headers = await client._get_headers()

        assert "Authorization" in headers
        assert headers["Authorization"] == "Bearer test-jwt"


class TestComputeClientReadFile:
    """Test read_file operation."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

    async def test_read_file_success(self, client: ComputeClient):
        """Test successful file read."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"content": "file content here"}
            mock_response.raise_for_status = MagicMock()

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await client.read_file("/workspace/main.py")

            assert result["success"] is True
            assert result["content"] == "file content here"
            assert result["path"] == "/workspace/main.py"

    async def test_read_file_not_found_returns_error(self, client: ComputeClient):
        """Test file read when file doesn't exist returns error dict."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 404

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await client.read_file("/nonexistent.py")

            assert result["success"] is False
            assert "not found" in result["error"].lower()

    async def test_read_file_permission_denied(self, client: ComputeClient):
        """Test file read when permission denied."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 403

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await client.read_file("/secret.py")

            assert result["success"] is False
            assert "permission denied" in result["error"].lower()

    async def test_read_file_http_error(self, client: ComputeClient):
        """Test file read on HTTP error."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 500
            mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
                "Server Error", request=MagicMock(), response=mock_response
            )

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await client.read_file("/test.py")

            assert result["success"] is False
            assert "HTTP error" in result["error"]

    async def test_read_file_timeout(self, client: ComputeClient):
        """Test file read timeout."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=httpx.TimeoutException("Request timed out")
            )

            result = await client.read_file("/test.py")

            assert result["success"] is False
            assert "timed out" in result["error"].lower()

    async def test_read_file_generic_exception(self, client: ComputeClient):
        """Test file read generic exception handling."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=Exception("Unexpected error")
            )

            result = await client.read_file("/test.py")

            assert result["success"] is False
            assert "Unexpected error" in result["error"]


class TestComputeClientWriteFile:
    """Test write_file operation."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

    async def test_write_file_success(self, client: ComputeClient):
        """Test successful file write."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.raise_for_status = MagicMock()

            mock_client.return_value.__aenter__.return_value.put = AsyncMock(
                return_value=mock_response
            )

            result = await client.write_file("/workspace/new.py", "print('hello')")

            assert result["success"] is True
            assert result["path"] == "/workspace/new.py"
            assert result["size"] == len("print('hello')")

    async def test_write_file_permission_denied(self, client: ComputeClient):
        """Test file write permission denied."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 403

            mock_client.return_value.__aenter__.return_value.put = AsyncMock(
                return_value=mock_response
            )

            result = await client.write_file("/readonly.py", "content")

            assert result["success"] is False
            assert "permission denied" in result["error"].lower()

    async def test_write_file_http_error(self, client: ComputeClient):
        """Test file write HTTP error."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 500
            mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
                "Server Error", request=MagicMock(), response=mock_response
            )

            mock_client.return_value.__aenter__.return_value.put = AsyncMock(
                return_value=mock_response
            )

            result = await client.write_file("/test.py", "content")

            assert result["success"] is False
            assert "HTTP error" in result["error"]

    async def test_write_file_timeout(self, client: ComputeClient):
        """Test file write timeout."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_client.return_value.__aenter__.return_value.put = AsyncMock(
                side_effect=httpx.TimeoutException("Request timed out")
            )

            result = await client.write_file("/test.py", "content")

            assert result["success"] is False
            assert "timed out" in result["error"].lower()


class TestComputeClientListFiles:
    """Test list_files operation."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

    async def test_list_files_success(self, client: ComputeClient):
        """Test successful directory listing."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = [
                {"name": "main.py", "type": "file"},
                {"name": "tests", "type": "directory"},
            ]
            mock_response.raise_for_status = MagicMock()

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await client.list_files("/workspace")

            assert result["success"] is True
            assert result["count"] == 2
            assert len(result["entries"]) == 2

    async def test_list_files_default_path(self, client: ComputeClient):
        """Test list files with default path."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = []
            mock_response.raise_for_status = MagicMock()

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await client.list_files()

            assert result["success"] is True
            assert result["path"] == "."

    async def test_list_files_not_found(self, client: ComputeClient):
        """Test list files directory not found."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 404

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await client.list_files("/nonexistent")

            assert result["success"] is False
            assert "not found" in result["error"].lower()


class TestComputeClientExecCommand:
    """Test exec_command operation."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

    async def test_exec_command_success(self, client: ComputeClient):
        """Test successful command execution."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "stdout": "hello world",
                "stderr": "",
                "exit_code": 0,
            }
            mock_response.raise_for_status = MagicMock()

            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )

            result = await client.exec_command("echo hello world")

            assert result["success"] is True
            assert result["exit_code"] == 0
            assert result["stdout"] == "hello world"
            assert result["command"] == "echo hello world"

    async def test_exec_command_with_failure(self, client: ComputeClient):
        """Test command execution with non-zero exit code."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "stdout": "",
                "stderr": "command not found",
                "exit_code": 127,
            }
            mock_response.raise_for_status = MagicMock()

            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )

            result = await client.exec_command("nonexistent_command")

            assert result["success"] is False
            assert result["exit_code"] == 127
            assert "command not found" in result["stderr"]

    async def test_exec_command_with_working_dir(self, client: ComputeClient):
        """Test command execution with working directory."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "stdout": "/home/dev/project",
                "stderr": "",
                "exit_code": 0,
            }
            mock_response.raise_for_status = MagicMock()

            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )

            result = await client.exec_command("pwd", working_dir="/home/dev/project")

            assert result["success"] is True

    async def test_exec_command_workspace_not_found(self, client: ComputeClient):
        """Test command execution when workspace not found."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 404

            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )

            result = await client.exec_command("ls")

            assert result["success"] is False
            assert "not found" in result["error"].lower()

    async def test_exec_command_timeout(self, client: ComputeClient):
        """Test command execution timeout."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                side_effect=httpx.TimeoutException("Timeout")
            )

            result = await client.exec_command("sleep 300", timeout=1)

            assert result["success"] is False
            assert "timed out" in result["error"].lower()


class TestComputeClientGlobFiles:
    """Test glob_files operation."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

    async def test_glob_files_success(self, client: ComputeClient):
        """Test successful glob files."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": True,
                "stdout": "./main.py\n./tests/test_main.py\n./utils.py",
                "stderr": "",
                "exit_code": 0,
            }

            result = await client.glob_files("*.py")

            assert result["success"] is True
            assert result["count"] == 3
            assert len(result["files"]) == 3

    async def test_glob_files_empty_result(self, client: ComputeClient):
        """Test glob files with no matches."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": True,
                "stdout": "",
                "stderr": "",
                "exit_code": 0,
            }

            result = await client.glob_files("*.nonexistent")

            assert result["success"] is True
            assert result["count"] == 0
            assert result["files"] == []

    async def test_glob_files_with_custom_path(self, client: ComputeClient):
        """Test glob files with custom base path."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": True,
                "stdout": "./src/main.py",
                "stderr": "",
                "exit_code": 0,
            }

            result = await client.glob_files("*.py", path="./src")

            assert result["success"] is True
            assert result["base_path"] == "./src"


class TestComputeClientGrep:
    """Test grep operation."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

    async def test_grep_success(self, client: ComputeClient):
        """Test successful grep search."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": True,
                "stdout": "main.py:10:def main():\nutils.py:5:def helper():",
                "stderr": "",
                "exit_code": 0,
            }

            result = await client.grep("def ")

            assert result["success"] is True
            assert result["count"] == 2
            assert result["results"][0]["file"] == "main.py"
            assert result["results"][0]["line"] == 10

    async def test_grep_with_file_pattern(self, client: ComputeClient):
        """Test grep with file pattern filter."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": True,
                "stdout": "test_main.py:15:def test_something():",
                "stderr": "",
                "exit_code": 0,
            }

            result = await client.grep("def test_", file_pattern="test_*.py")

            assert result["success"] is True
            assert result["count"] == 1

    async def test_grep_case_insensitive(self, client: ComputeClient):
        """Test grep with case insensitive search."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": True,
                "stdout": "readme.md:1:README",
                "stderr": "",
                "exit_code": 0,
            }

            result = await client.grep("readme", ignore_case=True)

            assert result["success"] is True

    async def test_grep_no_matches(self, client: ComputeClient):
        """Test grep with no matches."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": True,  # grep returns 1 but we handle it
                "stdout": "",
                "stderr": "",
                "exit_code": 1,
            }

            result = await client.grep("nonexistent_pattern_xyz")

            assert result["success"] is True
            assert result["count"] == 0


class TestComputeClientSearchCode:
    """Test search_code operation."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

    async def test_search_code_delegates_to_grep(self, client: ComputeClient):
        """Test that search_code delegates to grep."""
        with patch.object(client, "grep", new_callable=AsyncMock) as mock_grep:
            mock_grep.return_value = {
                "success": True,
                "results": [],
                "count": 0,
            }

            await client.search_code("def main")

            mock_grep.assert_called_once()
            call_kwargs = mock_grep.call_args[1]
            assert call_kwargs["ignore_case"] is True
            assert call_kwargs["context_lines"] == 0


class TestComputeClientGitCommand:
    """Test git_command operation."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

    async def test_git_command_success(self, client: ComputeClient):
        """Test successful git command."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": True,
                "stdout": "On branch main\nnothing to commit",
                "stderr": "",
                "exit_code": 0,
            }

            success, stdout, stderr = await client.git_command(["status"])

            assert success is True
            assert "On branch main" in stdout
            mock_exec.assert_called_once()

    async def test_git_command_failure(self, client: ComputeClient):
        """Test git command failure."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": False,
                "stdout": "",
                "stderr": "fatal: not a git repository",
                "exit_code": 128,
            }

            success, stdout, stderr = await client.git_command(["status"])

            assert success is False
            assert "not a git repository" in stderr

    async def test_git_command_with_multiple_args(self, client: ComputeClient):
        """Test git command with multiple arguments."""
        with patch.object(client, "exec_command", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = {
                "success": True,
                "stdout": "commit abc123",
                "stderr": "",
                "exit_code": 0,
            }

            await client.git_command(["log", "-1", "--oneline"])

            call_args = mock_exec.call_args
            assert "git log -1 --oneline" in call_args[0][0]


class TestComputeClientHealthCheck:
    """Test health_check operation."""

    @pytest.fixture
    def client(self) -> ComputeClient:
        """Create test client."""
        return ComputeClient(
            workspace_id="workspace-123",
            user_id="user-456",
            base_url="http://compute:8000",
        )

    async def test_health_check_success(self, client: ComputeClient):
        """Test successful health check."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 200

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await client.health_check()

            assert result is True

    async def test_health_check_workspace_not_found(self, client: ComputeClient):
        """Test health check when workspace not found."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_response = MagicMock()
            mock_response.status_code = 404

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await client.health_check()

            assert result is False

    async def test_health_check_exception(self, client: ComputeClient):
        """Test health check on exception."""
        with patch("httpx.AsyncClient") as mock_client, \
             patch("src.compute_client._get_service_auth") as mock_auth:
            mock_auth.return_value.get_auth_headers = AsyncMock(return_value={})
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=Exception("Connection error")
            )

            result = await client.health_check()

            assert result is False


class TestComputeClientErrorDataclass:
    """Test ComputeClientError exception."""

    def test_error_with_status_code(self):
        """Test creating error with status code."""
        error = ComputeClientError("Not Found", status_code=404)

        assert str(error) == "Not Found"
        assert error.status_code == 404

    def test_error_without_status_code(self):
        """Test creating error without status code."""
        error = ComputeClientError("Connection failed")

        assert str(error) == "Connection failed"
        assert error.status_code is None


class TestGetComputeClient:
    """Test get_compute_client factory function."""

    def setup_method(self) -> None:
        """Clear cache before each test."""
        clear_client_cache()

    async def test_get_compute_client_creates_instance(self) -> None:
        """Test that get_compute_client creates a ComputeClient."""
        # When base_url is provided, it skips database lookup
        client = await get_compute_client(
            "workspace-123", "user-456", base_url="http://compute:8000"
        )

        assert isinstance(client, ComputeClient)
        assert client.workspace_id == "workspace-123"
        assert client.user_id == "user-456"

    async def test_get_compute_client_caches_instance(self) -> None:
        """Test that get_compute_client caches instances."""
        client1 = await get_compute_client(
            "workspace-123", "user-456", base_url="http://compute:8000"
        )
        client2 = await get_compute_client(
            "workspace-123", "user-456", base_url="http://compute:8000"
        )

        assert client1 is client2

    async def test_get_compute_client_different_workspaces(self) -> None:
        """Test that different workspaces get different clients."""
        client1 = await get_compute_client(
            "workspace-123", "user-456", base_url="http://compute:8000"
        )
        client2 = await get_compute_client(
            "workspace-789", "user-456", base_url="http://compute:8000"
        )

        assert client1 is not client2

    async def test_get_compute_client_with_custom_url(self) -> None:
        """Test get_compute_client with custom base URL."""
        client = await get_compute_client(
            "workspace-123",
            "user-456",
            base_url="http://custom:8000",
        )

        assert client.base_url == "http://custom:8000"


class TestClearClientCache:
    """Test clear_client_cache function."""

    @pytest.mark.asyncio
    async def test_clear_client_cache(self):
        """Test clearing the client cache."""
        # Create some cached clients
        client1 = await get_compute_client("workspace-1", "user-1", base_url="http://compute:8000")
        client2 = await get_compute_client("workspace-2", "user-2", base_url="http://compute:8000")

        # Clear cache
        clear_client_cache()

        # New calls should create new instances
        client3 = await get_compute_client("workspace-1", "user-1", base_url="http://compute:8000")

        assert client1 is not client3


class TestServiceAuth:
    """Test service authentication."""

    def test_get_service_auth_caches_per_url(self) -> None:
        """Test that _get_service_auth caches instances per compute URL."""
        # Reset the module-level cache
        import src.compute_client as cc
        original_cache = cc._service_auth_cache.copy()
        cc._service_auth_cache.clear()

        try:
            with patch("src.compute_client.ServiceAuthClient") as mock_auth_class:
                mock_auth = MagicMock()
                mock_auth_class.return_value = mock_auth

                # First call creates instance for URL 1
                auth1 = _get_service_auth("http://compute1:8000")
                # Second call returns same instance
                auth2 = _get_service_auth("http://compute1:8000")
                # Different URL creates different instance
                auth3 = _get_service_auth("http://compute2:8000")

                assert auth1 == auth2
                assert auth1 == auth3  # Same mock, but would be different in real usage
                # Two calls for two different URLs
                assert mock_auth_class.call_count == 2
        finally:
            # Clean up - restore original cache
            cc._service_auth_cache.clear()
            cc._service_auth_cache.update(original_cache)
