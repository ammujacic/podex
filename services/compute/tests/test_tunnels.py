"""Tests for tunnel management routes."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.models.tunnel import (
    TunnelStartRequest,
    TunnelStartResponse,
    TunnelStatusResponse,
    TunnelStopRequest,
)


@pytest.fixture
def mock_workspace():
    """Create a mock workspace."""
    workspace = MagicMock()
    workspace.id = "ws-test-123"
    workspace.user_id = "test-user-123"
    workspace.container_id = "container-abc123"
    workspace.server_id = "server-1"
    return workspace


@pytest.fixture
def mock_compute_manager(mock_workspace):
    """Mock compute manager for tunnel tests."""
    manager = MagicMock()
    manager.get_workspace = AsyncMock(return_value=mock_workspace)
    manager.start_tunnel = AsyncMock(return_value={"status": "running", "pid": 12345})
    manager.stop_tunnel = AsyncMock(return_value={"status": "stopped"})
    manager.get_tunnel_status = AsyncMock(
        return_value={"status": "running", "processes": [{"pid": 12345, "cmd": "cloudflared"}]}
    )
    return manager


@pytest.fixture
def app_with_mocks(mock_compute_manager):
    """Create a test app with mocked dependencies."""
    from src.deps import get_compute_manager
    from src.main import app

    # Override dependencies
    app.dependency_overrides[get_compute_manager] = lambda: mock_compute_manager

    yield app

    # Clean up overrides
    app.dependency_overrides.clear()


class TestTunnelModels:
    """Test tunnel Pydantic models."""

    def test_tunnel_start_request_valid(self):
        """Test valid TunnelStartRequest."""
        req = TunnelStartRequest(token="test-token", port=3000)
        assert req.token == "test-token"
        assert req.port == 3000
        assert req.service_type == "http"

    def test_tunnel_start_request_ssh(self):
        """Test TunnelStartRequest with SSH service type."""
        req = TunnelStartRequest(token="test-token", port=22, service_type="ssh")
        assert req.service_type == "ssh"

    def test_tunnel_start_request_invalid_port(self):
        """Test TunnelStartRequest with invalid port."""
        with pytest.raises(ValueError):
            TunnelStartRequest(token="test-token", port=0)

        with pytest.raises(ValueError):
            TunnelStartRequest(token="test-token", port=70000)

    def test_tunnel_start_request_invalid_service_type(self):
        """Test TunnelStartRequest with invalid service type."""
        with pytest.raises(ValueError):
            TunnelStartRequest(token="test-token", port=3000, service_type="invalid")

    def test_tunnel_stop_request_valid(self):
        """Test valid TunnelStopRequest."""
        req = TunnelStopRequest(port=3000)
        assert req.port == 3000

    def test_tunnel_start_response(self):
        """Test TunnelStartResponse."""
        resp = TunnelStartResponse(status="running", pid=12345)
        assert resp.status == "running"
        assert resp.pid == 12345
        assert resp.error is None

    def test_tunnel_status_response(self):
        """Test TunnelStatusResponse."""
        resp = TunnelStatusResponse(status="stopped")
        assert resp.status == "stopped"
        assert resp.pid is None


class TestTunnelRoutes:
    """Test tunnel API routes."""

    @pytest.fixture
    def client(self, app_with_mocks, test_internal_api_key):
        """Create test client."""
        return TestClient(app_with_mocks)

    def test_start_tunnel_success(
        self, client, mock_compute_manager, test_user_id, test_internal_api_key
    ):
        """Test starting a tunnel successfully."""
        response = client.post(
            "/workspaces/ws-test-123/tunnels/start",
            json={"token": "test-token", "port": 3000, "service_type": "http"},
            headers={
                "X-User-ID": test_user_id,
                "X-Internal-API-Key": test_internal_api_key,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert data["pid"] == 12345

        # Verify compute manager was called correctly
        mock_compute_manager.start_tunnel.assert_called_once_with(
            workspace_id="ws-test-123",
            token="test-token",
            port=3000,
            service_type="http",
        )

    def test_start_tunnel_ssh(
        self, client, mock_compute_manager, test_user_id, test_internal_api_key
    ):
        """Test starting an SSH tunnel."""
        response = client.post(
            "/workspaces/ws-test-123/tunnels/start",
            json={"token": "test-token", "port": 22, "service_type": "ssh"},
            headers={
                "X-User-ID": test_user_id,
                "X-Internal-API-Key": test_internal_api_key,
            },
        )

        assert response.status_code == 200
        mock_compute_manager.start_tunnel.assert_called_once_with(
            workspace_id="ws-test-123",
            token="test-token",
            port=22,
            service_type="ssh",
        )

    def test_start_tunnel_workspace_not_found(
        self, client, mock_compute_manager, test_user_id, test_internal_api_key
    ):
        """Test starting tunnel for non-existent workspace."""
        mock_compute_manager.get_workspace = AsyncMock(return_value=None)

        response = client.post(
            "/workspaces/ws-nonexistent/tunnels/start",
            json={"token": "test-token", "port": 3000},
            headers={
                "X-User-ID": test_user_id,
                "X-Internal-API-Key": test_internal_api_key,
            },
        )

        assert response.status_code == 404

    def test_start_tunnel_unauthorized(
        self, client, mock_compute_manager, test_internal_api_key
    ):
        """Test starting tunnel with wrong user."""
        # Workspace belongs to different user
        mock_compute_manager.get_workspace.return_value.user_id = "other-user"

        response = client.post(
            "/workspaces/ws-test-123/tunnels/start",
            json={"token": "test-token", "port": 3000},
            headers={
                "X-User-ID": "wrong-user",
                "X-Internal-API-Key": test_internal_api_key,
            },
        )

        assert response.status_code == 403

    def test_stop_tunnel_success(
        self, client, mock_compute_manager, test_user_id, test_internal_api_key
    ):
        """Test stopping a tunnel successfully."""
        response = client.post(
            "/workspaces/ws-test-123/tunnels/stop",
            json={"port": 3000},
            headers={
                "X-User-ID": test_user_id,
                "X-Internal-API-Key": test_internal_api_key,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "stopped"

        mock_compute_manager.stop_tunnel.assert_called_once_with(
            workspace_id="ws-test-123",
            port=3000,
        )

    def test_get_tunnel_status_success(
        self, client, mock_compute_manager, test_user_id, test_internal_api_key
    ):
        """Test getting tunnel status."""
        response = client.get(
            "/workspaces/ws-test-123/tunnels/status",
            headers={
                "X-User-ID": test_user_id,
                "X-Internal-API-Key": test_internal_api_key,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert len(data["processes"]) == 1
        assert data["processes"][0]["pid"] == 12345

        mock_compute_manager.get_tunnel_status.assert_called_once_with(
            workspace_id="ws-test-123"
        )

    def test_start_tunnel_manager_error(
        self, client, mock_compute_manager, test_user_id, test_internal_api_key
    ):
        """Test error handling when compute manager fails."""
        mock_compute_manager.start_tunnel = AsyncMock(
            side_effect=ValueError("Container not running")
        )

        response = client.post(
            "/workspaces/ws-test-123/tunnels/start",
            json={"token": "test-token", "port": 3000},
            headers={
                "X-User-ID": test_user_id,
                "X-Internal-API-Key": test_internal_api_key,
            },
        )

        assert response.status_code == 500
        assert "Container not running" in response.json()["detail"]


class TestComputeManagerTunnelMethods:
    """Test ComputeManager tunnel method implementations."""

    @pytest.fixture
    def mock_docker_manager(self):
        """Create a mock Docker manager."""
        docker = MagicMock()
        # run_in_container returns tuple[int, str, str] (exit_code, stdout, stderr)
        docker.run_in_container = AsyncMock(return_value=(0, "12345\n", ""))
        return docker

    @pytest.fixture
    def mock_orchestrator(self):
        """Create a mock orchestrator."""
        return MagicMock()

    @pytest.fixture
    def mock_store(self, mock_workspace):
        """Create a mock workspace store."""
        store = MagicMock()
        store.get = AsyncMock(return_value=mock_workspace)
        return store

    @pytest.fixture
    def compute_manager(self, mock_orchestrator, mock_docker_manager, mock_store):
        """Create a compute manager with mocks."""
        from src.managers.multi_server_compute_manager import MultiServerComputeManager

        manager = MultiServerComputeManager(
            orchestrator=mock_orchestrator,
            docker_manager=mock_docker_manager,
            workspace_store=mock_store,
        )
        return manager

    @pytest.mark.asyncio
    async def test_start_tunnel_http(
        self, compute_manager, mock_docker_manager, mock_workspace
    ):
        """Test starting an HTTP tunnel."""
        result = await compute_manager.start_tunnel(
            workspace_id="ws-test-123",
            token="cf-token-abc",
            port=3000,
            service_type="http",
        )

        assert result["status"] == "running"
        assert result["pid"] == 12345

        # Verify the command was executed
        mock_docker_manager.run_in_container.assert_called_once()
        call_args = mock_docker_manager.run_in_container.call_args
        assert call_args[0][0] == mock_workspace.server_id
        assert call_args[0][1] == mock_workspace.container_id
        assert "cloudflared tunnel run" in call_args[0][2]
        assert "--token cf-token-abc" in call_args[0][2]
        assert "--url http://localhost:3000" in call_args[0][2]

    @pytest.mark.asyncio
    async def test_start_tunnel_ssh(
        self, compute_manager, mock_docker_manager, mock_workspace
    ):
        """Test starting an SSH tunnel."""
        result = await compute_manager.start_tunnel(
            workspace_id="ws-test-123",
            token="cf-token-abc",
            port=22,
            service_type="ssh",
        )

        assert result["status"] == "running"

        # SSH tunnels don't include --url flag
        call_args = mock_docker_manager.run_in_container.call_args
        cmd = call_args[0][2]
        assert "cloudflared tunnel run" in cmd
        assert "--url" not in cmd

    @pytest.mark.asyncio
    async def test_start_tunnel_workspace_not_found(self, compute_manager, mock_store):
        """Test starting tunnel for non-existent workspace."""
        mock_store.get = AsyncMock(return_value=None)

        with pytest.raises(ValueError, match="not found"):
            await compute_manager.start_tunnel(
                workspace_id="ws-nonexistent",
                token="token",
                port=3000,
            )

    @pytest.mark.asyncio
    async def test_stop_tunnel(self, compute_manager, mock_docker_manager, mock_workspace):
        """Test stopping a tunnel."""
        result = await compute_manager.stop_tunnel(
            workspace_id="ws-test-123",
            port=3000,
        )

        assert result["status"] == "stopped"

        # Verify pkill command was executed
        mock_docker_manager.run_in_container.assert_called_once()
        call_args = mock_docker_manager.run_in_container.call_args
        assert "pkill" in call_args[0][2]
        assert "cloudflared" in call_args[0][2]

    @pytest.mark.asyncio
    async def test_get_tunnel_status_running(
        self, compute_manager, mock_docker_manager, mock_workspace
    ):
        """Test getting status when tunnel is running."""
        # run_in_container returns tuple[int, str, str] (exit_code, stdout, stderr)
        mock_docker_manager.run_in_container = AsyncMock(
            return_value=(0, "12345 cloudflared tunnel run --token abc\n", "")
        )

        result = await compute_manager.get_tunnel_status(workspace_id="ws-test-123")

        assert result["status"] == "running"
        assert len(result["processes"]) == 1
        assert result["processes"][0]["pid"] == 12345

    @pytest.mark.asyncio
    async def test_get_tunnel_status_stopped(
        self, compute_manager, mock_docker_manager, mock_workspace
    ):
        """Test getting status when no tunnel is running."""
        # run_in_container returns tuple[int, str, str] (exit_code, stdout, stderr)
        mock_docker_manager.run_in_container = AsyncMock(
            return_value=(0, "none", "")
        )

        result = await compute_manager.get_tunnel_status(workspace_id="ws-test-123")

        assert result["status"] == "stopped"
        assert result["processes"] == []
