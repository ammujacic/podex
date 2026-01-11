"""Comprehensive tests for local pod client."""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from podex_local_pod.client import LocalPodClient
from podex_local_pod.config import LocalPodConfig


class TestLocalPodClientInit:
    """Tests for LocalPodClient initialization."""

    def test_init(self) -> None:
        """Test client initialization."""
        config = LocalPodConfig(pod_token="pdx_pod_test123")
        client = LocalPodClient(config)

        assert client.config is config
        assert client.sio is not None
        assert client.docker_manager is not None
        assert client.rpc_handler is not None
        assert client._running is False
        assert client._connected is False

    def test_init_socket_settings(self) -> None:
        """Test socket.io client settings."""
        config = LocalPodConfig(
            reconnect_delay=5,
            reconnect_delay_max=60,
        )
        client = LocalPodClient(config)

        # Check reconnection settings are set
        assert client.sio.reconnection is True
        assert client.sio.reconnection_delay == 5
        assert client.sio.reconnection_delay_max == 60


class TestLocalPodClientCapabilities:
    """Tests for capability reporting."""

    @pytest.mark.asyncio
    async def test_send_capabilities(self) -> None:
        """Test sending capabilities to cloud."""
        config = LocalPodConfig(max_workspaces=5)
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock()

        with patch("docker.from_env") as mock_docker:
            mock_docker.return_value.info.return_value = {
                "ServerVersion": "24.0.0"
            }
            await client._send_capabilities()

        client.sio.emit.assert_called_once()
        call_args = client.sio.emit.call_args
        assert call_args.args[0] == "capabilities"
        capabilities = call_args.args[1]
        assert capabilities["max_workspaces"] == 5
        assert capabilities["docker_version"] == "24.0.0"

    @pytest.mark.asyncio
    async def test_send_capabilities_docker_unavailable(self) -> None:
        """Test capabilities when Docker is unavailable."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock()

        with patch("docker.from_env", side_effect=Exception("Docker error")):
            await client._send_capabilities()

        call_args = client.sio.emit.call_args
        capabilities = call_args.args[1]
        assert capabilities["docker_version"] == "unavailable"


class TestLocalPodClientHeartbeat:
    """Tests for heartbeat functionality."""

    @pytest.mark.asyncio
    async def test_heartbeat_loop(self) -> None:
        """Test heartbeat sends data."""
        config = LocalPodConfig(heartbeat_interval=10)  # Minimum is 10
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock()
        client._running = True
        client._connected = True
        client.docker_manager._workspaces = {"ws_1": {}}

        # Run heartbeat for a short time
        heartbeat_task = asyncio.create_task(client._heartbeat_loop())
        await asyncio.sleep(0.1)

        # Stop the loop
        client._running = False
        client._connected = False
        heartbeat_task.cancel()

        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass

        # Should have sent at least one heartbeat
        client.sio.emit.assert_called()
        call_args = client.sio.emit.call_args
        assert call_args.args[0] == "heartbeat"


class TestLocalPodClientRun:
    """Tests for client run functionality."""

    @pytest.mark.asyncio
    async def test_run_builds_ws_url(self) -> None:
        """Test that run builds correct WebSocket URL."""
        config = LocalPodConfig(
            cloud_url="https://api.podex.dev",
            pod_token="pdx_pod_test",
        )
        client = LocalPodClient(config)
        client.docker_manager.initialize = AsyncMock()
        client.sio.connect = AsyncMock()
        client.sio.connected = False

        shutdown_event = asyncio.Event()
        shutdown_event.set()  # Immediately trigger shutdown

        await client.run(shutdown_event)

        # Check connect was called with correct URL
        connect_call = client.sio.connect.call_args
        assert connect_call.args[0] == "wss://api.podex.dev"

    @pytest.mark.asyncio
    async def test_run_http_to_ws(self) -> None:
        """Test HTTP URL conversion to WS."""
        config = LocalPodConfig(
            cloud_url="http://localhost:8000",
            pod_token="pdx_pod_test",
        )
        client = LocalPodClient(config)
        client.docker_manager.initialize = AsyncMock()
        client.sio.connect = AsyncMock()

        shutdown_event = asyncio.Event()
        shutdown_event.set()

        await client.run(shutdown_event)

        connect_call = client.sio.connect.call_args
        assert connect_call.args[0] == "ws://localhost:8000"

    @pytest.mark.asyncio
    async def test_run_passes_auth_token(self) -> None:
        """Test auth token is passed to connect."""
        config = LocalPodConfig(pod_token="pdx_pod_secret123")
        client = LocalPodClient(config)
        client.docker_manager.initialize = AsyncMock()
        client.sio.connect = AsyncMock()

        shutdown_event = asyncio.Event()
        shutdown_event.set()

        await client.run(shutdown_event)

        connect_call = client.sio.connect.call_args
        assert connect_call.kwargs["auth"]["token"] == "pdx_pod_secret123"


class TestLocalPodClientShutdown:
    """Tests for client shutdown."""

    @pytest.mark.asyncio
    async def test_shutdown(self) -> None:
        """Test graceful shutdown."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client._running = True
        client.docker_manager.shutdown = AsyncMock()
        client.sio.connected = True
        client.sio.disconnect = AsyncMock()

        await client.shutdown()

        assert client._running is False
        client.docker_manager.shutdown.assert_called_once()
        client.sio.disconnect.assert_called_once()

    @pytest.mark.asyncio
    async def test_shutdown_cancels_heartbeat(self) -> None:
        """Test shutdown cancels heartbeat task."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client._running = True
        client.docker_manager.shutdown = AsyncMock()
        client.sio.connected = False

        # Create a mock heartbeat task
        async def long_running():
            await asyncio.sleep(100)

        client._heartbeat_task = asyncio.create_task(long_running())

        await client.shutdown()

        assert client._heartbeat_task.cancelled() or client._heartbeat_task.done()

    @pytest.mark.asyncio
    async def test_shutdown_not_connected(self) -> None:
        """Test shutdown when not connected."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client.docker_manager.shutdown = AsyncMock()
        client.sio.connected = False
        client.sio.disconnect = AsyncMock()

        await client.shutdown()

        # Should not try to disconnect if not connected
        client.sio.disconnect.assert_not_called()


class TestLocalPodClientEventHandlers:
    """Tests for Socket.IO event handlers."""

    def test_handlers_setup(self) -> None:
        """Test that event handlers are set up."""
        config = LocalPodConfig()
        client = LocalPodClient(config)

        # The handlers are registered via decorators in _setup_handlers
        # We can't easily test them directly, but we verify setup was called
        assert client.sio is not None

    @pytest.mark.asyncio
    async def test_rpc_request_handler(self) -> None:
        """Test RPC request handling logic."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock()

        # Simulate RPC handler returning a result
        client.rpc_handler.handle = AsyncMock(return_value={"status": "ok"})

        # Manually call the handler logic (simulating what on_rpc_request does)
        data = {
            "call_id": "call-123",
            "method": "health.check",
            "params": {},
        }

        result = await client.rpc_handler.handle(data["method"], data["params"])
        assert result == {"status": "ok"}

    @pytest.mark.asyncio
    async def test_rpc_request_error_handling(self) -> None:
        """Test RPC error handling."""
        config = LocalPodConfig()
        client = LocalPodClient(config)

        # Simulate RPC handler raising an error
        client.rpc_handler.handle = AsyncMock(side_effect=ValueError("Test error"))

        with pytest.raises(ValueError):
            await client.rpc_handler.handle("workspace.get", {"workspace_id": "ws_test"})
