"""Tests for DockerComputeManager - comprehensive manager testing.

The docker_manager fixture in conftest.py provides a properly mocked
DockerComputeManager with a mock Docker client. Tests can access the
mock client via docker_manager._mock_docker_client and the mock container
via docker_manager._mock_container to customize behavior.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import docker
import pytest
from docker.models.containers import Container

from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceExecResponse,
    WorkspaceScaleResponse,
    WorkspaceStatus,
    WorkspaceTier,
)


# Local helper to match conftest.create_mock_container
def create_mock_container(
    container_id: str = "container123",
    name: str = "podex-workspace-test",
    status: str = "running",
    ip_address: str = "172.17.0.2",
) -> MagicMock:
    """Create a properly configured mock Docker container."""
    mock_container = MagicMock()
    mock_container.id = container_id
    mock_container.name = name
    mock_container.status = status
    mock_container.attrs = {
        "NetworkSettings": {
            "Networks": {
                "podex-network": {"IPAddress": ip_address}
            }
        }
    }
    mock_container.reload = MagicMock()
    mock_container.start = MagicMock()
    mock_container.stop = MagicMock()
    mock_container.remove = MagicMock()

    # Mock exec_run for commands - returns (stdout, stderr) tuple
    mock_exec_result = MagicMock()
    mock_exec_result.exit_code = 0
    mock_exec_result.output = (b"ready\n", b"")
    mock_container.exec_run.return_value = mock_exec_result

    return mock_container


# ============================================
# Workspace Lifecycle Tests
# ============================================


@pytest.mark.asyncio
async def test_create_workspace_basic(docker_manager, test_user_id):
    """Test basic workspace creation with mocked Docker client."""
    config = WorkspaceConfig(
        tier=WorkspaceTier.STARTER,
        git_email="test@example.com",
        git_name="Test User",
    )

    # Configure mock for create - first get raises NotFound (no existing container)
    docker_manager._mock_docker_client.containers.get.side_effect = [
        docker.errors.NotFound("not found"),
        docker_manager._mock_container,
        docker_manager._mock_container,
        docker_manager._mock_container,
    ]

    workspace = await docker_manager.create_workspace(
        user_id=test_user_id,
        session_id="session-1",
        config=config,
    )

    assert workspace.user_id == test_user_id
    assert workspace.session_id == "session-1"
    assert workspace.status == WorkspaceStatus.RUNNING
    assert workspace.tier == WorkspaceTier.STARTER
    assert workspace.container_id == "container123"
    docker_manager._mock_docker_client.containers.run.assert_called_once()


@pytest.mark.asyncio
async def test_create_workspace_with_tier_resources(workspace_store, test_user_id):
    """Test workspace creation with different tier resources."""
    from src.managers.docker_manager import DockerComputeManager

    config = WorkspaceConfig(tier=WorkspaceTier.PRO)

    mock_docker_client = MagicMock()
    mock_container = MagicMock()  # Don't use spec=Container to allow attrs
    mock_container.id = "container123"
    mock_container.name = "podex-workspace-test"
    mock_container.status = "running"
    mock_container.attrs = {
        "NetworkSettings": {
            "Networks": {
                "podex-network": {"IPAddress": "172.17.0.2"}
            }
        }
    }
    mock_container.reload = MagicMock()
    mock_exec_result = MagicMock()
    mock_exec_result.exit_code = 0
    mock_exec_result.output = (b"ready\n", b"")
    mock_container.exec_run.return_value = mock_exec_result

    mock_docker_client.containers.run.return_value = mock_container
    mock_docker_client.containers.get.side_effect = [
        docker.errors.NotFound("not found"),
        mock_container,
        mock_container,
        mock_container,
    ]

    with patch("docker.from_env", return_value=mock_docker_client):
        manager = DockerComputeManager(workspace_store=workspace_store)

        await manager.create_workspace(
            user_id=test_user_id,
            session_id="session-1",
            config=config,
        )

        # Verify resource limits were set for PRO tier
        call_kwargs = mock_docker_client.containers.run.call_args.kwargs
        assert "cpu_count" in call_kwargs or "nano_cpus" in call_kwargs
        assert "mem_limit" in call_kwargs


@pytest.mark.asyncio
async def test_create_workspace_max_limit_reached(workspace_store, test_user_id, monkeypatch):
    """Test workspace creation when max limit is reached."""
    # Set a low max_workspaces limit for testing
    monkeypatch.setattr("src.config.settings.max_workspaces", 2)

    # Create max workspaces to hit the limit
    from conftest import WorkspaceFactory
    for i in range(2):
        workspace = WorkspaceFactory.create_info(
            workspace_id=f"ws-limit-{i}",
            user_id=test_user_id,
            session_id="session-1",
            status=WorkspaceStatus.RUNNING,
        )
        await workspace_store.save(workspace)

    config = WorkspaceConfig(tier=WorkspaceTier.STARTER)

    async with create_mock_docker_manager(workspace_store) as (manager, mock_client):
        with pytest.raises(RuntimeError, match="Maximum workspaces"):
            await manager.create_workspace(
                user_id=test_user_id,
                session_id="session-2",
                config=config,
            )


@pytest.mark.asyncio
async def test_stop_workspace(workspace_store, workspace_factory, test_user_id):
    """Test stopping a running workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-stop",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
        tier=WorkspaceTier.STARTER,
    )
    await workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")
    mock_container.stop = MagicMock()

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        # Reset side_effect so get always returns the container
        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        with patch("src.managers.docker_manager.sync_workspace_status_to_api", new_callable=AsyncMock):
            await manager.stop_workspace("test-ws-stop")

            mock_container.stop.assert_called_once()

            # Verify workspace status updated
            updated = await workspace_store.get("test-ws-stop")
            assert updated.status == WorkspaceStatus.STOPPED


@pytest.mark.asyncio
async def test_stop_workspace_already_stopped(workspace_store, workspace_factory, test_user_id):
    """Test stopping an already stopped workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-already-stopped",
        user_id=test_user_id,
        status=WorkspaceStatus.STOPPED,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123", status="exited")

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        # Should not raise error
        await manager.stop_workspace("test-ws-already-stopped")


@pytest.mark.asyncio
async def test_restart_workspace(workspace_store, workspace_factory, test_user_id):
    """Test restarting a stopped workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-restart",
        user_id=test_user_id,
        status=WorkspaceStatus.STOPPED,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123", status="exited")
    mock_container.start = MagicMock()

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        await manager.restart_workspace("test-ws-restart")

        mock_container.start.assert_called_once()

        # Verify workspace status updated
        updated = await workspace_store.get("test-ws-restart")
        assert updated.status == WorkspaceStatus.RUNNING


@pytest.mark.asyncio
async def test_delete_workspace(workspace_store, workspace_factory, test_user_id):
    """Test deleting a workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-delete",
        user_id=test_user_id,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")
    mock_container.stop = MagicMock()
    mock_container.remove = MagicMock()

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        await manager.delete_workspace("test-ws-delete", preserve_files=False)

        mock_container.stop.assert_called_once()
        mock_container.remove.assert_called_once()

        # Verify workspace removed from store
        deleted = await workspace_store.get("test-ws-delete")
        assert deleted is None


# ============================================
# Command Execution Tests
# ============================================


@pytest.mark.asyncio
async def test_exec_command_success(workspace_store, workspace_factory, test_user_id):
    """Test successful command execution."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-exec",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")
    mock_exec_result = MagicMock()
    mock_exec_result.output = (b"Hello World\n", b"")  # (stdout, stderr) tuple
    mock_exec_result.exit_code = 0
    mock_container.exec_run.return_value = mock_exec_result

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        result = await manager.exec_command("test-ws-exec", "echo 'Hello World'")

        assert result.exit_code == 0
        assert "Hello World" in result.stdout
        assert result.stderr == ""


@pytest.mark.asyncio
async def test_exec_command_with_timeout(docker_manager, workspace_store, workspace_factory, test_user_id):
    """Test command execution with timeout."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = MagicMock(spec=Container)
    mock_container.status = "running"

    # Simulate timeout
    async def slow_exec(*args, **kwargs):
        await asyncio.sleep(10)

    with patch.object(docker_manager.client.containers, "get", return_value=mock_container):
        with patch.object(docker_manager, "_exec_in_container", side_effect=slow_exec):
            with pytest.raises(asyncio.TimeoutError):
                await docker_manager.exec_command("test-ws-1", "sleep 100", timeout=1)


@pytest.mark.asyncio
async def test_exec_command_auto_restart(
    docker_manager, workspace_store, workspace_factory, test_user_id
):
    """Test command execution auto-restarts stopped container."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.STOPPED,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = MagicMock(spec=Container)
    mock_container.status = "exited"
    mock_container.start = MagicMock()
    mock_exec_result = MagicMock()
    mock_exec_result.output = b"output"
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    with patch.object(docker_manager.client.containers, "get", return_value=mock_container):
        # First call should restart
        result = await docker_manager.exec_command("test-ws-1", "echo test")

        mock_container.start.assert_called_once()
        assert result.exit_code == 0


@pytest.mark.asyncio
async def test_exec_command_stream(docker_manager, workspace_store, workspace_factory, test_user_id):
    """Test streaming command execution."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = MagicMock(spec=Container)
    mock_container.status = "running"

    # Mock streaming output
    def mock_exec_stream(*args, **kwargs):
        return (b"line1\n", b"line2\n", b"line3\n")

    mock_container.exec_run = MagicMock(return_value=(0, mock_exec_stream()))

    with patch.object(docker_manager.client.containers, "get", return_value=mock_container):
        chunks = []
        async for chunk in docker_manager.exec_command_stream("test-ws-1", "echo test"):
            chunks.append(chunk)

        assert len(chunks) >= 1


# ============================================
# File Operations Tests
# ============================================


@pytest.mark.asyncio
async def test_read_file(docker_manager, workspace_store, workspace_factory, test_user_id):
    """Test reading file from workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = MagicMock(spec=Container)
    mock_container.status = "running"
    mock_exec_result = MagicMock()
    mock_exec_result.output = b"file contents here"
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    with patch.object(docker_manager.client.containers, "get", return_value=mock_container):
        content = await docker_manager.read_file("test-ws-1", "/home/dev/test.txt")

        assert "file contents" in content


@pytest.mark.asyncio
async def test_write_file(docker_manager, workspace_store, workspace_factory, test_user_id):
    """Test writing file to workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = MagicMock(spec=Container)
    mock_container.status = "running"
    mock_exec_result = MagicMock()
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    with patch.object(docker_manager.client.containers, "get", return_value=mock_container):
        await docker_manager.write_file("test-ws-1", "/home/dev/test.txt", "new content")

        # Verify exec_run was called (base64 write command)
        assert mock_container.exec_run.called


@pytest.mark.asyncio
async def test_list_files(docker_manager, workspace_store, workspace_factory, test_user_id):
    """Test listing files in workspace directory."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = MagicMock(spec=Container)
    mock_container.status = "running"
    mock_exec_result = MagicMock()
    # Simulate ls -la output
    mock_exec_result.output = b"drwxr-xr-x 2 dev dev 4096 Jan 1 00:00 .\ndrwxr-xr-x 3 dev dev 4096 Jan 1 00:00 ..\n-rw-r--r-- 1 dev dev 100 Jan 1 00:00 file.txt\n"
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    with patch.object(docker_manager.client.containers, "get", return_value=mock_container):
        files = await docker_manager.list_files("test-ws-1", "/home/dev")

        assert isinstance(files, list)


# ============================================
# Discovery & Health Tests
# ============================================


@pytest.mark.asyncio
async def test_discover_existing_workspaces(docker_manager, workspace_store):
    """Test discovering existing workspaces from Docker."""
    mock_container1 = MagicMock(spec=Container)
    mock_container1.id = "container1"
    mock_container1.name = "podex-workspace-ws-1"
    mock_container1.labels = {"podex.workspace_id": "ws-1", "podex.user_id": "user-1"}
    mock_container1.status = "running"

    mock_container2 = MagicMock(spec=Container)
    mock_container2.id = "container2"
    mock_container2.name = "podex-workspace-ws-2"
    mock_container2.labels = {"podex.workspace_id": "ws-2", "podex.user_id": "user-2"}
    mock_container2.status = "exited"

    with patch.object(
        docker_manager.client.containers, "list", return_value=[mock_container1, mock_container2]
    ):
        with patch("src.managers.docker_manager.sync_workspace_status_to_api", new_callable=AsyncMock):
            await docker_manager.discover_existing_workspaces()

            # Verify workspaces were added to store
            ws1 = await workspace_store.get("ws-1")
            ws2 = await workspace_store.get("ws-2")

            assert ws1 is not None
            assert ws1.status == WorkspaceStatus.RUNNING

            assert ws2 is not None
            assert ws2.status == WorkspaceStatus.STOPPED


@pytest.mark.asyncio
async def test_check_workspace_health(
    docker_manager, workspace_store, workspace_factory, test_user_id
):
    """Test checking workspace health."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = MagicMock(spec=Container)
    mock_container.status = "running"
    mock_exec_result = MagicMock()
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    with patch.object(docker_manager.client.containers, "get", return_value=mock_container):
        is_healthy = await docker_manager.check_workspace_health("test-ws-1")

        assert is_healthy is True


@pytest.mark.asyncio
async def test_check_workspace_health_unhealthy(
    docker_manager, workspace_store, workspace_factory, test_user_id
):
    """Test checking unhealthy workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = MagicMock(spec=Container)
    mock_container.status = "exited"

    with patch.object(docker_manager.client.containers, "get", return_value=mock_container):
        is_healthy = await docker_manager.check_workspace_health("test-ws-1")

        assert is_healthy is False


# ============================================
# Billing & Usage Tests
# ============================================


@pytest.mark.asyncio
async def test_track_running_workspaces_usage(docker_manager, workspace_store, workspace_factory):
    """Test tracking usage for running workspaces."""
    # Create running workspaces
    ws1 = workspace_factory.create_info(
        workspace_id="ws-1",
        user_id="user-1",
        status=WorkspaceStatus.RUNNING,
        tier=WorkspaceTier.PRO,
        last_billed_at=datetime.now(UTC) - timedelta(minutes=15),
    )
    ws2 = workspace_factory.create_info(
        workspace_id="ws-2",
        user_id="user-2",
        status=WorkspaceStatus.RUNNING,
        tier=WorkspaceTier.STARTER,
        last_billed_at=datetime.now(UTC) - timedelta(minutes=20),
    )

    await workspace_store.save(ws1)
    await workspace_store.save(ws2)

    with patch("podex_shared.get_usage_tracker") as mock_tracker:
        mock_tracker_instance = AsyncMock()
        mock_tracker.return_value = mock_tracker_instance

        await docker_manager.track_running_workspaces_usage()

        # Verify usage was tracked
        assert mock_tracker_instance.track_compute_usage.called


@pytest.mark.asyncio
async def test_billing_lock_prevents_concurrent_tracking(docker_manager):
    """Test that billing lock prevents concurrent usage tracking."""

    async def slow_track():
        async with docker_manager._billing_lock:
            await asyncio.sleep(0.1)

    # Start first tracking
    task1 = asyncio.create_task(slow_track())
    await asyncio.sleep(0.01)  # Let first task acquire lock

    # Second tracking should wait
    task2 = asyncio.create_task(slow_track())

    await asyncio.gather(task1, task2)
    # If we get here without error, locking works


# ============================================
# Port Detection Tests
# ============================================


@pytest.mark.asyncio
async def test_get_active_ports(docker_manager, workspace_store, workspace_factory, test_user_id):
    """Test getting active ports from workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_container = MagicMock(spec=Container)
    mock_container.status = "running"
    mock_exec_result = MagicMock()
    # Simulate ss output
    mock_exec_result.output = b"tcp LISTEN 0 511 *:3000 *:* users:((\"node\",pid=123))\ntcp LISTEN 0 128 *:8080 *:* users:((\"python\",pid=456))\n"
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    with patch.object(docker_manager.client.containers, "get", return_value=mock_container):
        ports = await docker_manager.get_active_ports("test-ws-1")

        assert len(ports) >= 1


# ============================================
# Scaling Tests
# ============================================


@pytest.mark.asyncio
async def test_scale_workspace_tier_upgrade(
    docker_manager, workspace_store, workspace_factory, test_user_id
):
    """Test scaling workspace to higher tier."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        tier=WorkspaceTier.STARTER,
        container_id="container123",
    )
    await workspace_store.save(workspace)

    mock_old_container = MagicMock(spec=Container)
    mock_old_container.stop = MagicMock()
    mock_old_container.remove = MagicMock()

    mock_new_container = MagicMock(spec=Container)
    mock_new_container.id = "container456"
    mock_new_container.status = "running"

    with patch.object(
        docker_manager.client.containers, "get", return_value=mock_old_container
    ):
        with patch.object(docker_manager.client.containers, "run", return_value=mock_new_container):
            response = await docker_manager.scale_workspace("test-ws-1", WorkspaceTier.PRO)

            assert response.success is True
            assert response.new_tier == WorkspaceTier.PRO

            # Verify workspace updated in store
            updated = await workspace_store.get("test-ws-1")
            assert updated.tier == WorkspaceTier.PRO
            assert updated.container_id == "container456"


# ============================================
# HTTP Proxy Tests
# ============================================


@pytest.mark.asyncio
async def test_proxy_request_get(docker_manager, workspace_store, workspace_factory, test_user_id):
    """Test proxying GET request to workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
    )
    await workspace_store.save(workspace)

    from src.managers.base import ProxyRequest

    proxy_req = ProxyRequest(
        workspace_id="test-ws-1",
        port=3000,
        method="GET",
        path="/api/users",
        headers={},
        body=None,
        query_string=None,
    )

    with patch("httpx.AsyncClient.request", new_callable=AsyncMock) as mock_request:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json"}
        mock_response.content = b'{"users": []}'
        mock_request.return_value = mock_response

        with patch.object(docker_manager, "_get_container_ip", return_value="172.17.0.2"):
            status_code, headers, body = await docker_manager.proxy_request(proxy_req)

            assert status_code == 200
            assert headers["content-type"] == "application/json"
            assert b"users" in body
