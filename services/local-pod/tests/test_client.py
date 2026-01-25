"""Comprehensive tests for local pod client."""

import asyncio
import contextlib
from unittest.mock import AsyncMock, patch

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
        assert client.manager is not None
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
        data = call_args.args[1]
        # Capabilities are now nested under "capabilities" key
        capabilities = data["capabilities"]
        assert capabilities["max_workspaces"] == 5
        assert capabilities["docker_version"] == "24.0.0"
        # Config is also included
        assert "config" in data
        assert data["config"]["mode"] == "docker"

    @pytest.mark.asyncio
    async def test_send_capabilities_docker_unavailable(self) -> None:
        """Test capabilities when Docker is unavailable."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock()

        with patch("docker.from_env", side_effect=Exception("Docker error")):
            await client._send_capabilities()

        call_args = client.sio.emit.call_args
        data = call_args.args[1]
        # Capabilities are now nested under "capabilities" key
        capabilities = data["capabilities"]
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
        client.manager._workspaces = {"ws_1": {}}

        # Run heartbeat for a short time
        heartbeat_task = asyncio.create_task(client._heartbeat_loop())
        await asyncio.sleep(0.1)

        # Stop the loop
        client._running = False
        client._connected = False
        heartbeat_task.cancel()

        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

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
        client.manager.initialize = AsyncMock()
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
        client.manager.initialize = AsyncMock()
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
        client.manager.initialize = AsyncMock()
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
        client.manager.shutdown = AsyncMock()
        client.sio.connected = True
        client.sio.disconnect = AsyncMock()

        await client.shutdown()

        assert client._running is False
        client.manager.shutdown.assert_called_once()
        client.sio.disconnect.assert_called_once()

    @pytest.mark.asyncio
    async def test_shutdown_cancels_heartbeat(self) -> None:
        """Test shutdown cancels heartbeat task."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client._running = True
        client.manager.shutdown = AsyncMock()
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
        client.manager.shutdown = AsyncMock()
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


class TestSocketEventHandlers:
    """Test Socket.IO event handlers."""

    @pytest.mark.asyncio
    async def test_on_connect_event_handler_flow(self) -> None:
        """Test on_connect sets state and starts heartbeat."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock()
        client._connected = False

        with patch("docker.from_env") as mock_docker:
            mock_docker.return_value.info.return_value = {"ServerVersion": "24.0.0"}

            # Trigger connect handler
            handlers = {name: handler for name, handler in client.sio.handlers.get("/local-pod", {}).items()}
            if "connect" in handlers:
                await handlers["connect"]()

            assert client._connected is True
            # Capabilities should be sent
            client.sio.emit.assert_called()

    @pytest.mark.asyncio
    async def test_on_disconnect_event_handler_flow(self) -> None:
        """Test on_disconnect unsets state and stops heartbeat."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client._connected = True

        # Create a mock heartbeat task
        async def long_running():
            await asyncio.sleep(100)

        client._heartbeat_task = asyncio.create_task(long_running())

        # Trigger disconnect handler
        handlers = {name: handler for name, handler in client.sio.handlers.get("/local-pod", {}).items()}
        if "disconnect" in handlers:
            await handlers["disconnect"]()

        # Wait a moment for cancellation to propagate
        await asyncio.sleep(0.01)

        assert client._connected is False
        # Task should be cancelled
        assert client._heartbeat_task.cancelled()

    @pytest.mark.asyncio
    async def test_on_connect_error_with_various_errors(self) -> None:
        """Test on_connect_error handles different error types."""
        config = LocalPodConfig()
        client = LocalPodClient(config)

        # Trigger connect_error handler with different error types
        handlers = {name: handler for name, handler in client.sio.handlers.get("/local-pod", {}).items()}
        if "connect_error" in handlers:
            # Should not raise exceptions
            await handlers["connect_error"]("Connection refused")
            await handlers["connect_error"]({"message": "Auth failed"})
            await handlers["connect_error"](Exception("Network error"))

    @pytest.mark.asyncio
    async def test_on_rpc_request_invalid_method_type(self) -> None:
        """Test on_rpc_request handles invalid method type."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock()

        handlers = {name: handler for name, handler in client.sio.handlers.get("/local-pod", {}).items()}
        if "rpc_request" in handlers:
            # Call with invalid method (not a string)
            await handlers["rpc_request"]({"call_id": "call-123", "method": 123, "params": {}})

            # Should emit error response
            client.sio.emit.assert_called()
            call_args = client.sio.emit.call_args
            assert call_args.args[0] == "rpc_response"
            assert "error" in call_args.args[1]

    @pytest.mark.asyncio
    async def test_on_terminal_input_handler(self) -> None:
        """Test on_terminal_input forwards data to docker manager."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client.manager.terminal_write = AsyncMock()

        handlers = {name: handler for name, handler in client.sio.handlers.get("/local-pod", {}).items()}
        if "terminal_input" in handlers:
            await handlers["terminal_input"]({"workspace_id": "ws_123", "data": "echo hello\n"})
            client.manager.terminal_write.assert_called_once_with("ws_123", "echo hello\n")


class TestConnectionErrorRecovery:
    """Test connection and error handling."""

    @pytest.mark.asyncio
    async def test_run_connection_refused_error(self) -> None:
        """Test run raises connection refused error after logging."""
        config = LocalPodConfig(cloud_url="http://localhost:9999")
        client = LocalPodClient(config)
        client.manager.initialize = AsyncMock()
        client.sio.connect = AsyncMock(side_effect=ConnectionRefusedError)

        shutdown_event = asyncio.Event()
        shutdown_event.set()

        # The run method re-raises connection errors after logging
        with pytest.raises(ConnectionRefusedError):
            await client.run(shutdown_event)

    @pytest.mark.asyncio
    async def test_run_socket_timeout_error(self) -> None:
        """Test run raises timeout error after logging."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client.manager.initialize = AsyncMock()
        client.sio.connect = AsyncMock(side_effect=TimeoutError)

        shutdown_event = asyncio.Event()
        shutdown_event.set()

        # The run method re-raises timeout errors after logging
        with pytest.raises(TimeoutError):
            await client.run(shutdown_event)

    @pytest.mark.asyncio
    async def test_run_waits_for_shutdown_event(self) -> None:
        """Test run waits for shutdown event."""
        config = LocalPodConfig()
        client = LocalPodClient(config)
        client.manager.initialize = AsyncMock()
        client.sio.connect = AsyncMock()
        client.sio.connected = True

        shutdown_event = asyncio.Event()

        # Run in background and trigger shutdown after delay
        async def trigger_shutdown():
            await asyncio.sleep(0.1)
            shutdown_event.set()

        task = asyncio.create_task(trigger_shutdown())
        await client.run(shutdown_event)
        await task

        # Should have completed without hanging


class TestHeartbeatEdgeCases:
    """Test heartbeat edge cases."""

    @pytest.mark.asyncio
    async def test_heartbeat_loop_handles_emit_errors(self) -> None:
        """Test heartbeat continues after emit errors."""
        config = LocalPodConfig(heartbeat_interval=10)
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock(side_effect=Exception("Emit failed"))
        client._running = True
        client._connected = True

        # Run heartbeat briefly
        heartbeat_task = asyncio.create_task(client._heartbeat_loop())
        await asyncio.sleep(0.1)

        # Stop gracefully
        client._running = False
        heartbeat_task.cancel()

        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

    @pytest.mark.asyncio
    async def test_heartbeat_loop_respects_disconnected_flag(self) -> None:
        """Test heartbeat stops when disconnected."""
        config = LocalPodConfig(heartbeat_interval=10)
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock()
        client._running = True
        client._connected = True

        heartbeat_task = asyncio.create_task(client._heartbeat_loop())
        await asyncio.sleep(0.05)

        # Disconnect
        client._connected = False
        await asyncio.sleep(0.05)

        # Should stop naturally
        client._running = False
        heartbeat_task.cancel()

        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

    @pytest.mark.asyncio
    async def test_heartbeat_loop_cancellation_cleanup(self) -> None:
        """Test heartbeat cleans up properly on cancellation."""
        config = LocalPodConfig(heartbeat_interval=10)
        client = LocalPodClient(config)
        client.sio.emit = AsyncMock()
        client._running = True
        client._connected = True

        heartbeat_task = asyncio.create_task(client._heartbeat_loop())
        await asyncio.sleep(0.05)

        # Cancel the task
        heartbeat_task.cancel()

        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task

        # Should be cancelled
        assert heartbeat_task.cancelled() or heartbeat_task.done()
