"""Comprehensive tests for RPC handler."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from podex_local_pod.rpc_handler import RPCHandler


class TestRPCHandlerInit:
    """Tests for RPCHandler initialization."""

    def test_init(self) -> None:
        """Test handler initialization."""
        mock_docker = MagicMock()
        handler = RPCHandler(mock_docker)

        assert handler.docker is mock_docker
        assert len(handler._handlers) > 0

    def test_handlers_registered(self) -> None:
        """Test all handlers are registered."""
        mock_docker = MagicMock()
        handler = RPCHandler(mock_docker)

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
        ]

        for method in expected_methods:
            assert method in handler._handlers


class TestRPCHandlerDispatch:
    """Tests for RPC method dispatch."""

    @pytest.fixture
    def mock_docker_manager(self) -> MagicMock:
        """Create mock Docker manager."""
        mock = MagicMock()
        mock.workspaces = {}
        mock.create_workspace = AsyncMock(
            return_value={"id": "ws_test", "status": "running"}
        )
        mock.stop_workspace = AsyncMock()
        mock.delete_workspace = AsyncMock()
        mock.get_workspace = AsyncMock(return_value={"id": "ws_test"})
        mock.list_workspaces = AsyncMock(return_value=[])
        mock.heartbeat = AsyncMock()
        mock.exec_command = AsyncMock(
            return_value={"exit_code": 0, "stdout": "", "stderr": ""}
        )
        mock.read_file = AsyncMock(return_value="file content")
        mock.write_file = AsyncMock()
        mock.list_files = AsyncMock(return_value=[])
        mock.get_active_ports = AsyncMock(return_value=[])
        mock.proxy_request = AsyncMock(
            return_value={"status_code": 200, "headers": {}, "body": None}
        )
        return mock

    @pytest.mark.asyncio
    async def test_handle_unknown_method(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling unknown RPC method."""
        handler = RPCHandler(mock_docker_manager)

        with pytest.raises(ValueError, match="Unknown RPC method"):
            await handler.handle("unknown.method", {})

    @pytest.mark.asyncio
    async def test_handle_workspace_create(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.create."""
        handler = RPCHandler(mock_docker_manager)

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
        mock_docker_manager.create_workspace.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_workspace_stop(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.stop."""
        handler = RPCHandler(mock_docker_manager)

        await handler.handle("workspace.stop", {"workspace_id": "ws_test"})

        mock_docker_manager.stop_workspace.assert_called_once_with("ws_test")

    @pytest.mark.asyncio
    async def test_handle_workspace_delete(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.delete."""
        handler = RPCHandler(mock_docker_manager)

        await handler.handle(
            "workspace.delete",
            {"workspace_id": "ws_test", "preserve_files": False},
        )

        mock_docker_manager.delete_workspace.assert_called_once_with(
            "ws_test", preserve_files=False
        )

    @pytest.mark.asyncio
    async def test_handle_workspace_delete_preserve_default(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test delete defaults to preserve_files=True."""
        handler = RPCHandler(mock_docker_manager)

        await handler.handle("workspace.delete", {"workspace_id": "ws_test"})

        mock_docker_manager.delete_workspace.assert_called_once_with(
            "ws_test", preserve_files=True
        )

    @pytest.mark.asyncio
    async def test_handle_workspace_get(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.get."""
        handler = RPCHandler(mock_docker_manager)

        result = await handler.handle("workspace.get", {"workspace_id": "ws_test"})

        assert result["id"] == "ws_test"
        mock_docker_manager.get_workspace.assert_called_once_with("ws_test")

    @pytest.mark.asyncio
    async def test_handle_workspace_list(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.list."""
        mock_docker_manager.list_workspaces.return_value = [{"id": "ws_1"}]
        handler = RPCHandler(mock_docker_manager)

        result = await handler.handle(
            "workspace.list",
            {"user_id": "user-123", "session_id": "session-456"},
        )

        assert result == [{"id": "ws_1"}]
        mock_docker_manager.list_workspaces.assert_called_once_with(
            user_id="user-123", session_id="session-456"
        )

    @pytest.mark.asyncio
    async def test_handle_workspace_heartbeat(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.heartbeat."""
        handler = RPCHandler(mock_docker_manager)

        await handler.handle("workspace.heartbeat", {"workspace_id": "ws_test"})

        mock_docker_manager.heartbeat.assert_called_once_with("ws_test")

    @pytest.mark.asyncio
    async def test_handle_workspace_exec(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.exec."""
        mock_docker_manager.exec_command.return_value = {
            "exit_code": 0,
            "stdout": "hello",
            "stderr": "",
        }
        handler = RPCHandler(mock_docker_manager)

        result = await handler.handle(
            "workspace.exec",
            {
                "workspace_id": "ws_test",
                "command": "echo hello",
                "working_dir": "/home/dev",
                "timeout": 60,
            },
        )

        assert result["exit_code"] == 0
        assert result["stdout"] == "hello"
        mock_docker_manager.exec_command.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_workspace_read_file(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.read_file."""
        handler = RPCHandler(mock_docker_manager)

        result = await handler.handle(
            "workspace.read_file",
            {"workspace_id": "ws_test", "path": "/path/file.txt"},
        )

        assert result == "file content"
        mock_docker_manager.read_file.assert_called_once_with("ws_test", "/path/file.txt")

    @pytest.mark.asyncio
    async def test_handle_workspace_write_file(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.write_file."""
        handler = RPCHandler(mock_docker_manager)

        await handler.handle(
            "workspace.write_file",
            {
                "workspace_id": "ws_test",
                "path": "/path/file.txt",
                "content": "new content",
            },
        )

        mock_docker_manager.write_file.assert_called_once_with(
            "ws_test", "/path/file.txt", "new content"
        )

    @pytest.mark.asyncio
    async def test_handle_workspace_list_files(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.list_files."""
        mock_docker_manager.list_files.return_value = [
            {"name": "file.txt", "type": "file"}
        ]
        handler = RPCHandler(mock_docker_manager)

        result = await handler.handle(
            "workspace.list_files",
            {"workspace_id": "ws_test", "path": "/home/dev"},
        )

        assert len(result) == 1
        mock_docker_manager.list_files.assert_called_once_with("ws_test", "/home/dev")

    @pytest.mark.asyncio
    async def test_handle_workspace_list_files_default_path(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test list_files uses default path."""
        handler = RPCHandler(mock_docker_manager)

        await handler.handle("workspace.list_files", {"workspace_id": "ws_test"})

        mock_docker_manager.list_files.assert_called_once_with("ws_test", ".")

    @pytest.mark.asyncio
    async def test_handle_workspace_get_ports(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.get_ports."""
        mock_docker_manager.get_active_ports.return_value = [
            {"port": 3000, "process_name": "node"}
        ]
        handler = RPCHandler(mock_docker_manager)

        result = await handler.handle(
            "workspace.get_ports", {"workspace_id": "ws_test"}
        )

        assert len(result) == 1
        assert result[0]["port"] == 3000

    @pytest.mark.asyncio
    async def test_handle_workspace_proxy(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling workspace.proxy."""
        handler = RPCHandler(mock_docker_manager)

        result = await handler.handle(
            "workspace.proxy",
            {
                "workspace_id": "ws_test",
                "port": 3000,
                "method": "GET",
                "path": "/api/data",
                "headers": {"Accept": "application/json"},
                "body": None,
                "query_string": "key=value",
            },
        )

        assert result["status_code"] == 200
        mock_docker_manager.proxy_request.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_workspace_proxy_with_body(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test proxy with body (hex encoded)."""
        handler = RPCHandler(mock_docker_manager)

        body_hex = b"hello".hex()
        await handler.handle(
            "workspace.proxy",
            {
                "workspace_id": "ws_test",
                "port": 3000,
                "method": "POST",
                "path": "/api/data",
                "headers": {},
                "body": body_hex,
            },
        )

        call_args = mock_docker_manager.proxy_request.call_args
        assert call_args.kwargs["body"] == b"hello"

    @pytest.mark.asyncio
    async def test_handle_health_check(
        self, mock_docker_manager: MagicMock
    ) -> None:
        """Test handling health.check."""
        mock_docker_manager.workspaces = {"ws_1": {}, "ws_2": {}}
        handler = RPCHandler(mock_docker_manager)

        result = await handler.handle("health.check", {})

        assert result["status"] == "healthy"
        assert result["workspaces"] == 2
