"""Comprehensive tests for Docker manager."""

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from podex_local_pod.config import LocalPodConfig
from podex_local_pod.docker_manager import LocalDockerManager, _generate_workspace_id


class TestGenerateWorkspaceId:
    """Tests for workspace ID generation."""

    def test_generates_unique_ids(self) -> None:
        """Test that workspace IDs are unique."""
        ids = [_generate_workspace_id() for _ in range(100)]
        assert len(set(ids)) == 100  # All unique

    def test_format(self) -> None:
        """Test workspace ID format."""
        ws_id = _generate_workspace_id()
        assert ws_id.startswith("ws_")
        assert len(ws_id) == 15  # "ws_" + 12 hex chars


class TestLocalDockerManagerInit:
    """Tests for LocalDockerManager initialization."""

    def test_init(self) -> None:
        """Test manager initialization."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        assert manager.config is config
        assert manager._client is None
        assert manager._workspaces == {}
        assert manager._terminal_sessions == {}

    def test_workspaces_property(self) -> None:
        """Test workspaces property."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        manager._workspaces = {"ws_123": {"id": "ws_123"}}
        assert manager.workspaces == {"ws_123": {"id": "ws_123"}}


class TestLocalDockerManagerInitialize:
    """Tests for manager initialization."""

    @pytest.mark.asyncio
    async def test_initialize_success(self, mock_docker_client: MagicMock) -> None:
        """Test successful initialization."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)

        with patch("docker.from_env", return_value=mock_docker_client):
            await manager.initialize()

        assert manager._client is mock_docker_client
        mock_docker_client.info.assert_called_once()

    @pytest.mark.asyncio
    async def test_initialize_docker_error(self) -> None:
        """Test initialization with Docker error."""
        import docker

        config = LocalPodConfig()
        manager = LocalDockerManager(config)

        with patch(
            "docker.from_env",
            side_effect=docker.errors.DockerException("Connection failed"),
        ):
            with pytest.raises(docker.errors.DockerException):
                await manager.initialize()

    @pytest.mark.asyncio
    async def test_ensure_network_exists(self, mock_docker_client: MagicMock) -> None:
        """Test network exists scenario."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        manager._client = mock_docker_client

        await manager._ensure_network()

        mock_docker_client.networks.get.assert_called_once_with("podex-local")
        mock_docker_client.networks.create.assert_not_called()

    @pytest.mark.asyncio
    async def test_ensure_network_creates(self, mock_docker_client: MagicMock) -> None:
        """Test network creation when not exists."""
        import docker

        mock_docker_client.networks.get.side_effect = docker.errors.NotFound("Not found")

        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        manager._client = mock_docker_client

        await manager._ensure_network()

        mock_docker_client.networks.create.assert_called_once()


class TestLocalDockerManagerWorkspaces:
    """Tests for workspace management."""

    @pytest.fixture
    def manager_with_client(
        self, mock_docker_client: MagicMock, mock_container: MagicMock
    ) -> LocalDockerManager:
        """Create manager with mocked client."""
        mock_docker_client.containers.run.return_value = mock_container
        mock_docker_client.containers.get.return_value = mock_container

        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        manager._client = mock_docker_client
        return manager

    @pytest.mark.asyncio
    async def test_create_workspace(
        self, manager_with_client: LocalDockerManager
    ) -> None:
        """Test creating a workspace."""
        result = await manager_with_client.create_workspace(
            workspace_id="ws_test123",
            user_id="user-456",
            session_id="session-789",
            config={"tier": "starter"},
        )

        assert result["id"] == "ws_test123"
        assert result["user_id"] == "user-456"
        assert result["session_id"] == "session-789"
        assert result["status"] == "running"
        assert result["tier"] == "starter"
        assert "ws_test123" in manager_with_client._workspaces

    @pytest.mark.asyncio
    async def test_create_workspace_generates_id(
        self, manager_with_client: LocalDockerManager
    ) -> None:
        """Test workspace ID generation when not provided."""
        result = await manager_with_client.create_workspace(
            workspace_id=None,
            user_id="user-456",
            session_id="session-789",
            config={},
        )

        assert result["id"].startswith("ws_")
        assert len(result["id"]) == 15

    @pytest.mark.asyncio
    async def test_create_workspace_max_limit(
        self, manager_with_client: LocalDockerManager
    ) -> None:
        """Test workspace creation fails when limit reached."""
        # Fill up workspaces to max
        manager_with_client._workspaces = {
            f"ws_{i}": {"id": f"ws_{i}"} for i in range(3)
        }

        with pytest.raises(RuntimeError, match="Maximum workspace limit"):
            await manager_with_client.create_workspace(
                workspace_id="ws_new",
                user_id="user-456",
                session_id="session-789",
                config={},
            )

    @pytest.mark.asyncio
    async def test_create_workspace_image_not_found(
        self, mock_docker_client: MagicMock
    ) -> None:
        """Test workspace creation with missing image."""
        import docker

        mock_docker_client.containers.run.side_effect = docker.errors.ImageNotFound(
            "Image not found"
        )

        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        manager._client = mock_docker_client

        with pytest.raises(RuntimeError, match="Workspace image not found"):
            await manager.create_workspace(
                workspace_id="ws_test",
                user_id="user",
                session_id="session",
                config={},
            )

    @pytest.mark.asyncio
    async def test_stop_workspace(
        self, manager_with_client: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test stopping a workspace."""
        manager_with_client._workspaces["ws_test123"] = {
            "id": "ws_test123",
            "container_id": "abc123",
            "status": "running",
        }

        await manager_with_client.stop_workspace("ws_test123")

        mock_container.stop.assert_called_once_with(timeout=10)
        assert manager_with_client._workspaces["ws_test123"]["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_stop_workspace_not_found(
        self, manager_with_client: LocalDockerManager
    ) -> None:
        """Test stopping non-existent workspace."""
        # Should not raise
        await manager_with_client.stop_workspace("nonexistent")

    @pytest.mark.asyncio
    async def test_delete_workspace(
        self, manager_with_client: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test deleting a workspace."""
        manager_with_client._workspaces["ws_test123"] = {
            "id": "ws_test123",
            "container_id": "abc123",
        }

        await manager_with_client.delete_workspace("ws_test123")

        mock_container.stop.assert_called()
        mock_container.remove.assert_called_with(force=True)
        assert "ws_test123" not in manager_with_client._workspaces

    @pytest.mark.asyncio
    async def test_get_workspace(
        self, manager_with_client: LocalDockerManager
    ) -> None:
        """Test getting workspace info."""
        workspace = {"id": "ws_test123", "status": "running"}
        manager_with_client._workspaces["ws_test123"] = workspace

        result = await manager_with_client.get_workspace("ws_test123")
        assert result == workspace

    @pytest.mark.asyncio
    async def test_get_workspace_not_found(
        self, manager_with_client: LocalDockerManager
    ) -> None:
        """Test getting non-existent workspace."""
        result = await manager_with_client.get_workspace("nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_list_workspaces(
        self, manager_with_client: LocalDockerManager
    ) -> None:
        """Test listing workspaces."""
        manager_with_client._workspaces = {
            "ws_1": {"id": "ws_1", "user_id": "user-1", "session_id": "session-1"},
            "ws_2": {"id": "ws_2", "user_id": "user-2", "session_id": "session-2"},
        }

        result = await manager_with_client.list_workspaces()
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_list_workspaces_filter_by_user(
        self, manager_with_client: LocalDockerManager
    ) -> None:
        """Test listing workspaces filtered by user."""
        manager_with_client._workspaces = {
            "ws_1": {"id": "ws_1", "user_id": "user-1", "session_id": "session-1"},
            "ws_2": {"id": "ws_2", "user_id": "user-2", "session_id": "session-2"},
        }

        result = await manager_with_client.list_workspaces(user_id="user-1")
        assert len(result) == 1
        assert result[0]["user_id"] == "user-1"

    @pytest.mark.asyncio
    async def test_list_workspaces_filter_by_session(
        self, manager_with_client: LocalDockerManager
    ) -> None:
        """Test listing workspaces filtered by session."""
        manager_with_client._workspaces = {
            "ws_1": {"id": "ws_1", "user_id": "user-1", "session_id": "session-1"},
            "ws_2": {"id": "ws_2", "user_id": "user-1", "session_id": "session-2"},
        }

        result = await manager_with_client.list_workspaces(session_id="session-2")
        assert len(result) == 1
        assert result[0]["session_id"] == "session-2"

    @pytest.mark.asyncio
    async def test_heartbeat(self, manager_with_client: LocalDockerManager) -> None:
        """Test workspace heartbeat."""
        manager_with_client._workspaces["ws_test"] = {
            "id": "ws_test",
            "last_activity": "2024-01-01T00:00:00+00:00",
        }

        await manager_with_client.heartbeat("ws_test")

        # Should have updated timestamp
        assert (
            manager_with_client._workspaces["ws_test"]["last_activity"]
            != "2024-01-01T00:00:00+00:00"
        )


class TestLocalDockerManagerTierResources:
    """Tests for tier resource mapping."""

    def test_get_tier_resources_starter(self) -> None:
        """Test starter tier resources."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)

        cpu, mem = manager._get_tier_resources("starter")
        assert cpu == 2
        assert mem == "4096m"

    def test_get_tier_resources_pro(self) -> None:
        """Test pro tier resources."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)

        cpu, mem = manager._get_tier_resources("pro")
        assert cpu == 4
        assert mem == "8192m"

    def test_get_tier_resources_power(self) -> None:
        """Test power tier resources."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)

        cpu, mem = manager._get_tier_resources("power")
        assert cpu == 8
        assert mem == "16384m"

    def test_get_tier_resources_enterprise(self) -> None:
        """Test enterprise tier resources."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)

        cpu, mem = manager._get_tier_resources("enterprise")
        assert cpu == 16
        assert mem == "32768m"

    def test_get_tier_resources_unknown(self) -> None:
        """Test unknown tier defaults to starter."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)

        cpu, mem = manager._get_tier_resources("unknown")
        assert cpu == 2
        assert mem == "4096m"

    def test_get_tier_resources_case_insensitive(self) -> None:
        """Test tier is case insensitive."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)

        cpu, mem = manager._get_tier_resources("PRO")
        assert cpu == 4
        assert mem == "8192m"


class TestLocalDockerManagerCommands:
    """Tests for command execution."""

    @pytest.fixture
    def manager_with_workspace(
        self, mock_docker_client: MagicMock, mock_container: MagicMock
    ) -> LocalDockerManager:
        """Create manager with a workspace."""
        mock_docker_client.containers.get.return_value = mock_container

        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        manager._client = mock_docker_client
        manager._workspaces["ws_test"] = {
            "id": "ws_test",
            "container_id": "abc123",
        }
        return manager

    @pytest.mark.asyncio
    async def test_exec_command(
        self, manager_with_workspace: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test executing a command."""
        mock_container.exec_run.return_value = MagicMock(
            exit_code=0,
            output=(b"output", b""),
        )

        result = await manager_with_workspace.exec_command("ws_test", "echo hello")

        assert result["exit_code"] == 0
        assert result["stdout"] == "output"
        assert result["stderr"] == ""

    @pytest.mark.asyncio
    async def test_exec_command_with_stderr(
        self, manager_with_workspace: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test command with stderr output."""
        mock_container.exec_run.return_value = MagicMock(
            exit_code=1,
            output=(b"", b"error message"),
        )

        result = await manager_with_workspace.exec_command("ws_test", "bad command")

        assert result["exit_code"] == 1
        assert result["stderr"] == "error message"

    @pytest.mark.asyncio
    async def test_exec_command_workspace_not_found(
        self, manager_with_workspace: LocalDockerManager
    ) -> None:
        """Test command on non-existent workspace."""
        with pytest.raises(ValueError, match="Workspace not found"):
            await manager_with_workspace.exec_command("nonexistent", "echo hello")

    @pytest.mark.asyncio
    async def test_read_file(
        self, manager_with_workspace: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test reading a file."""
        mock_container.exec_run.return_value = MagicMock(
            exit_code=0,
            output=(b"file content", b""),
        )

        result = await manager_with_workspace.read_file("ws_test", "/path/to/file.txt")

        assert result == "file content"

    @pytest.mark.asyncio
    async def test_read_file_error(
        self, manager_with_workspace: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test reading non-existent file."""
        mock_container.exec_run.return_value = MagicMock(
            exit_code=1,
            output=(b"", b"No such file"),
        )

        with pytest.raises(ValueError, match="Failed to read file"):
            await manager_with_workspace.read_file("ws_test", "/nonexistent")

    @pytest.mark.asyncio
    async def test_write_file(
        self, manager_with_workspace: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test writing a file."""
        mock_container.exec_run.return_value = MagicMock(
            exit_code=0,
            output=(b"", b""),
        )

        await manager_with_workspace.write_file("ws_test", "/path/file.txt", "content")

        mock_container.exec_run.assert_called()

    @pytest.mark.asyncio
    async def test_write_file_error(
        self, manager_with_workspace: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test write file failure."""
        mock_container.exec_run.return_value = MagicMock(
            exit_code=1,
            output=(b"", b"Permission denied"),
        )

        with pytest.raises(ValueError, match="Failed to write file"):
            await manager_with_workspace.write_file("ws_test", "/root/file.txt", "content")

    @pytest.mark.asyncio
    async def test_list_files(
        self, manager_with_workspace: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test listing files."""
        ls_output = """total 16
drwxr-xr-x 2 dev dev 4096 Jan  1 00:00 .
drwxr-xr-x 3 dev dev 4096 Jan  1 00:00 ..
-rw-r--r-- 1 dev dev  100 Jan  1 00:00 file.txt
drwxr-xr-x 2 dev dev 4096 Jan  1 00:00 folder"""
        mock_container.exec_run.return_value = MagicMock(
            exit_code=0,
            output=(ls_output.encode(), b""),
        )

        result = await manager_with_workspace.list_files("ws_test", ".")

        assert len(result) == 4
        files = [f for f in result if f["type"] == "file"]
        dirs = [f for f in result if f["type"] == "directory"]
        assert len(files) == 1
        assert len(dirs) == 3  # . and .. and folder


class TestLocalDockerManagerPorts:
    """Tests for port detection."""

    @pytest.fixture
    def manager_with_workspace(
        self, mock_docker_client: MagicMock, mock_container: MagicMock
    ) -> LocalDockerManager:
        """Create manager with a workspace."""
        mock_docker_client.containers.get.return_value = mock_container

        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        manager._client = mock_docker_client
        manager._workspaces["ws_test"] = {
            "id": "ws_test",
            "container_id": "abc123",
        }
        return manager

    @pytest.mark.asyncio
    async def test_get_active_ports(
        self, manager_with_workspace: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test getting active ports."""
        ss_output = """LISTEN 0 4096 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=123,fd=20))
LISTEN 0 4096 0.0.0.0:5000 0.0.0.0:* users:(("python",pid=456,fd=10))"""
        mock_container.exec_run.return_value = MagicMock(
            exit_code=0,
            output=(ss_output.encode(), b""),
        )

        result = await manager_with_workspace.get_active_ports("ws_test")

        assert len(result) == 2
        ports = [p["port"] for p in result]
        assert 3000 in ports
        assert 5000 in ports

    @pytest.mark.asyncio
    async def test_get_active_ports_empty(
        self, manager_with_workspace: LocalDockerManager, mock_container: MagicMock
    ) -> None:
        """Test getting ports when none listening."""
        mock_container.exec_run.return_value = MagicMock(
            exit_code=0,
            output=(b"", b""),
        )

        result = await manager_with_workspace.get_active_ports("ws_test")
        assert result == []


class TestLocalDockerManagerProxy:
    """Tests for HTTP proxy functionality."""

    @pytest.fixture
    def manager_with_workspace(self) -> LocalDockerManager:
        """Create manager with a workspace."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        manager._workspaces["ws_test"] = {
            "id": "ws_test",
            "host": "172.17.0.2",
        }
        return manager

    @pytest.mark.asyncio
    async def test_proxy_request(
        self, manager_with_workspace: LocalDockerManager
    ) -> None:
        """Test proxying HTTP request."""
        import httpx

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"Content-Type": "text/html"}
        mock_response.content = b"<html>Hello</html>"

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = MagicMock()
            mock_client.request = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock()
            mock_client_class.return_value = mock_client

            result = await manager_with_workspace.proxy_request(
                workspace_id="ws_test",
                port=3000,
                method="GET",
                path="index.html",
                headers={"Accept": "text/html"},
                body=None,
                query_string=None,
            )

        assert result["status_code"] == 200
        assert "Content-Type" in result["headers"]

    @pytest.mark.asyncio
    async def test_proxy_request_workspace_not_found(
        self, manager_with_workspace: LocalDockerManager
    ) -> None:
        """Test proxy with non-existent workspace."""
        with pytest.raises(ValueError, match="Workspace not found"):
            await manager_with_workspace.proxy_request(
                workspace_id="nonexistent",
                port=3000,
                method="GET",
                path="/",
                headers={},
                body=None,
                query_string=None,
            )


class TestLocalDockerManagerShutdown:
    """Tests for shutdown functionality."""

    @pytest.mark.asyncio
    async def test_shutdown(
        self, mock_docker_client: MagicMock, mock_container: MagicMock
    ) -> None:
        """Test graceful shutdown."""
        mock_docker_client.containers.get.return_value = mock_container

        config = LocalPodConfig()
        manager = LocalDockerManager(config)
        manager._client = mock_docker_client
        manager._workspaces = {
            "ws_1": {"id": "ws_1", "container_id": "abc"},
            "ws_2": {"id": "ws_2", "container_id": "def"},
        }

        await manager.shutdown()

        assert manager._workspaces == {}

    @pytest.mark.asyncio
    async def test_terminal_write(self) -> None:
        """Test terminal write (placeholder)."""
        config = LocalPodConfig()
        manager = LocalDockerManager(config)

        # Should not raise
        await manager.terminal_write("ws_test", "some data")
