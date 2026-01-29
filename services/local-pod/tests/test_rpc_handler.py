"""Comprehensive tests for RPC handler.

Tests the stateless RPC handler that receives working_dir with each call.
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from podex_local_pod.rpc_handler import RPCHandler


class TestRPCHandlerInit:
    """Tests for RPCHandler initialization."""

    def test_init(self) -> None:
        """Test handler initialization."""
        mock_manager = MagicMock()
        handler = RPCHandler(mock_manager)

        assert handler.manager is mock_manager
        assert len(handler._handlers) > 0

    def test_handlers_registered(self) -> None:
        """Test all handlers are registered."""
        mock_manager = MagicMock()
        handler = RPCHandler(mock_manager)

        expected_methods = [
            "workspace.create",
            "workspace.stop",
            "workspace.delete",
            "workspace.get",
            "workspace.list",
            "workspace.heartbeat",
            "workspace.exec",
            "workspace.read_file",
            "workspace.write_file",
            "workspace.list_files",
            "workspace.get_ports",
            "workspace.proxy",
            "health.check",
            "terminal.create",
            "terminal.input",
            "terminal.resize",
            "terminal.close",
            "host.browse",
        ]

        for method in expected_methods:
            assert method in handler._handlers


class TestRPCHandlerDispatch:
    """Tests for RPC method dispatch."""

    @pytest.fixture
    def mock_manager(self) -> MagicMock:
        """Create mock native manager (stateless)."""
        mock = MagicMock()
        mock.workspaces = {}
        mock.create_workspace = AsyncMock(
            return_value={"id": "ws_test", "status": "running"}
        )
        mock.stop_workspace = AsyncMock()
        mock.delete_workspace = AsyncMock()
        mock.get_workspace = AsyncMock(return_value=None)  # Stateless - returns None
        mock.update_workspace = AsyncMock(return_value=None)
        mock.list_workspaces = AsyncMock(return_value=[])  # Stateless - returns empty
        mock.heartbeat = AsyncMock()
        mock.proxy_request = AsyncMock(
            return_value={"status": 200, "headers": {}, "body": None}
        )
        return mock

    @pytest.mark.asyncio
    async def test_handle_unknown_method(self, mock_manager: MagicMock) -> None:
        """Test handling unknown RPC method."""
        handler = RPCHandler(mock_manager)

        with pytest.raises(ValueError, match="Unknown RPC method"):
            await handler.handle("unknown.method", {})

    @pytest.mark.asyncio
    async def test_handle_workspace_create(self, mock_manager: MagicMock) -> None:
        """Test handling workspace.create."""
        handler = RPCHandler(mock_manager)

        result = await handler.handle(
            "workspace.create",
            {
                "workspace_id": "ws_test",
                "user_id": "user-123",
                "session_id": "session-456",
                "config": {"tier": "starter"},
            },
        )

        assert result["id"] == "ws_test"
        mock_manager.create_workspace.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_workspace_stop(self, mock_manager: MagicMock) -> None:
        """Test handling workspace.stop."""
        handler = RPCHandler(mock_manager)

        await handler.handle("workspace.stop", {"workspace_id": "ws_test"})

        mock_manager.stop_workspace.assert_called_once_with("ws_test")

    @pytest.mark.asyncio
    async def test_handle_workspace_delete(self, mock_manager: MagicMock) -> None:
        """Test handling workspace.delete."""
        handler = RPCHandler(mock_manager)

        await handler.handle(
            "workspace.delete",
            {"workspace_id": "ws_test", "preserve_files": False},
        )

        mock_manager.delete_workspace.assert_called_once_with(
            "ws_test", preserve_files=False
        )

    @pytest.mark.asyncio
    async def test_handle_workspace_get(self, mock_manager: MagicMock) -> None:
        """Test handling workspace.get (stateless - returns None)."""
        handler = RPCHandler(mock_manager)

        result = await handler.handle("workspace.get", {"workspace_id": "ws_test"})

        assert result is None  # Stateless mode returns None
        mock_manager.get_workspace.assert_called_once_with("ws_test")

    @pytest.mark.asyncio
    async def test_handle_workspace_list(self, mock_manager: MagicMock) -> None:
        """Test handling workspace.list (stateless - returns empty)."""
        handler = RPCHandler(mock_manager)

        result = await handler.handle(
            "workspace.list",
            {"user_id": "user-123", "session_id": "session-456"},
        )

        assert result == []  # Stateless mode returns empty
        mock_manager.list_workspaces.assert_called_once_with(
            user_id="user-123", session_id="session-456"
        )

    @pytest.mark.asyncio
    async def test_handle_workspace_heartbeat(self, mock_manager: MagicMock) -> None:
        """Test handling workspace.heartbeat."""
        handler = RPCHandler(mock_manager)

        await handler.handle("workspace.heartbeat", {"workspace_id": "ws_test"})

        mock_manager.heartbeat.assert_called_once_with("ws_test")

    @pytest.mark.asyncio
    async def test_handle_health_check(self, mock_manager: MagicMock) -> None:
        """Test handling health.check."""
        mock_manager.workspaces = {}  # Stateless - empty
        handler = RPCHandler(mock_manager)

        result = await handler.handle("health.check", {})

        assert result["status"] == "healthy"
        assert result["mode"] == "native"
        assert result["workspaces"] == 0


class TestRPCCommandExecution:
    """Tests for command execution (stateless - uses working_dir)."""

    @pytest.fixture
    def handler(self) -> RPCHandler:
        """Create handler with mock manager."""
        mock_manager = MagicMock()
        mock_manager.workspaces = {}
        return RPCHandler(mock_manager)

    @pytest.mark.asyncio
    async def test_exec_command_with_working_dir(self, handler: RPCHandler) -> None:
        """Test command execution uses working_dir from params."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = await handler.handle(
                "workspace.exec",
                {
                    "workspace_id": "ws_test",
                    "command": "pwd",
                    "working_dir": tmpdir,
                    "timeout": 10,
                },
            )

            assert result["exit_code"] == 0
            assert tmpdir in result["stdout"]

    @pytest.mark.asyncio
    async def test_exec_command_default_working_dir(self, handler: RPCHandler) -> None:
        """Test command execution defaults to home directory."""
        result = await handler.handle(
            "workspace.exec",
            {
                "workspace_id": "ws_test",
                "command": "pwd",
                "timeout": 10,
            },
        )

        assert result["exit_code"] == 0
        # Should be in home directory
        assert os.path.expanduser("~") in result["stdout"]

    @pytest.mark.asyncio
    async def test_exec_command_timeout(self, handler: RPCHandler) -> None:
        """Test command timeout handling."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = await handler.handle(
                "workspace.exec",
                {
                    "workspace_id": "ws_test",
                    "command": "sleep 10",
                    "working_dir": tmpdir,
                    "timeout": 1,
                },
            )

            assert result["exit_code"] == 124  # Timeout exit code
            assert "timed out" in result["stderr"].lower()


class TestRPCFileOperations:
    """Tests for file operations (stateless - uses working_dir)."""

    @pytest.fixture
    def handler(self) -> RPCHandler:
        """Create handler with mock manager."""
        mock_manager = MagicMock()
        mock_manager.workspaces = {}
        return RPCHandler(mock_manager)

    @pytest.mark.asyncio
    async def test_write_and_read_file(self, handler: RPCHandler) -> None:
        """Test writing and reading a file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write file
            await handler.handle(
                "workspace.write_file",
                {
                    "workspace_id": "ws_test",
                    "path": "test.txt",
                    "content": "hello world",
                    "working_dir": tmpdir,
                },
            )

            # Read file back
            content = await handler.handle(
                "workspace.read_file",
                {
                    "workspace_id": "ws_test",
                    "path": "test.txt",
                    "working_dir": tmpdir,
                },
            )

            assert content == "hello world"

    @pytest.mark.asyncio
    async def test_list_files(self, handler: RPCHandler) -> None:
        """Test listing files in directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create some files
            Path(tmpdir, "file1.txt").write_text("content1")
            Path(tmpdir, "file2.txt").write_text("content2")
            Path(tmpdir, "subdir").mkdir()

            files = await handler.handle(
                "workspace.list_files",
                {
                    "workspace_id": "ws_test",
                    "path": ".",
                    "working_dir": tmpdir,
                },
            )

            names = [f["name"] for f in files]
            assert "file1.txt" in names
            assert "file2.txt" in names
            assert "subdir" in names

            # Check directory is listed first
            assert files[0]["type"] == "directory"

    @pytest.mark.asyncio
    async def test_delete_file(self, handler: RPCHandler) -> None:
        """Test deleting a file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a file
            test_file = Path(tmpdir, "to_delete.txt")
            test_file.write_text("delete me")
            assert test_file.exists()

            # Delete it
            await handler.handle(
                "workspace.delete_file",
                {
                    "workspace_id": "ws_test",
                    "path": "to_delete.txt",
                    "working_dir": tmpdir,
                },
            )

            assert not test_file.exists()


class TestHostBrowse:
    """Tests for host filesystem browsing."""

    @pytest.fixture
    def handler(self) -> RPCHandler:
        """Create handler with mock manager."""
        mock_manager = MagicMock()
        mock_manager.workspaces = {}
        return RPCHandler(mock_manager)

    @pytest.mark.asyncio
    async def test_browse_home_directory(self, handler: RPCHandler) -> None:
        """Test browsing home directory."""
        result = await handler.handle("host.browse", {"path": "~"})

        assert result["is_home"] is True
        assert result["path"] == str(Path.home())
        assert isinstance(result["entries"], list)

    @pytest.mark.asyncio
    async def test_browse_temp_directory(self, handler: RPCHandler) -> None:
        """Test browsing a temp directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test files
            Path(tmpdir, "test.txt").write_text("test")
            Path(tmpdir, "subdir").mkdir()

            result = await handler.handle("host.browse", {"path": tmpdir})

            # Use Path.resolve() to handle macOS /private symlink
            assert Path(result["path"]).resolve() == Path(tmpdir).resolve()
            names = [e["name"] for e in result["entries"]]
            assert "test.txt" in names
            assert "subdir" in names

    @pytest.mark.asyncio
    async def test_browse_nonexistent_path(self, handler: RPCHandler) -> None:
        """Test browsing non-existent path."""
        result = await handler.handle("host.browse", {"path": "/nonexistent/path"})

        assert "error" in result
        assert result["entries"] == []
