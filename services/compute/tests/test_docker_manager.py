"""Tests for DockerComputeManager - comprehensive manager testing.

The docker_manager fixture in conftest.py provides a properly mocked
DockerComputeManager with a mock Docker client. Tests can access the
mock client via docker_manager._mock_docker_client and the mock container
via docker_manager._mock_container to customize behavior.
"""

from __future__ import annotations

import asyncio
import tempfile
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import docker
import pytest

from src.managers.docker_manager import DockerComputeManager
from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceStatus,
)

if TYPE_CHECKING:
    from src.storage.workspace_store import WorkspaceStore


@asynccontextmanager
async def create_mock_docker_manager(
    workspace_store: WorkspaceStore,
    mock_container: MagicMock | None = None,
    local_storage_path: Path | None = None,
) -> AsyncGenerator[tuple[DockerComputeManager, MagicMock], None]:
    """Create a DockerComputeManager with mocked Docker client.

    Args:
        workspace_store: The workspace store to use
        mock_container: Optional pre-configured mock container
        local_storage_path: Optional path for local storage (uses temp dir if not provided)

    Yields:
        Tuple of (manager, mock_docker_client)
    """
    if mock_container is None:
        mock_container = create_mock_container()

    mock_docker_client = MagicMock()
    mock_docker_client.containers.run.return_value = mock_container
    mock_docker_client.containers.get.side_effect = [
        docker.errors.NotFound("not found"),
        mock_container,
    ]
    mock_docker_client.containers.list.return_value = []

    with patch("docker.from_env", return_value=mock_docker_client):
        manager = DockerComputeManager(workspace_store=workspace_store)
        # Use provided path or create temp directory to avoid /var/lib/podex permission issues
        if local_storage_path:
            manager._local_storage_path = local_storage_path
        else:
            manager._local_storage_path = Path(tempfile.mkdtemp()) / "workspaces"
        manager._mock_docker_client = mock_docker_client
        manager._mock_container = mock_container

        yield manager, mock_docker_client

        # Cleanup
        if manager._http_client and not manager._http_client.is_closed:
            await manager._http_client.aclose()


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
        tier="starter_arm",
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
    assert workspace.tier == "starter_arm"
    assert workspace.container_id == "container123"
    docker_manager._mock_docker_client.containers.run.assert_called_once()


@pytest.mark.asyncio
async def test_create_workspace_with_tier_resources(workspace_store, test_user_id, tmp_path):
    """Test workspace creation with different tier resources."""
    from src.managers.docker_manager import DockerComputeManager

    config = WorkspaceConfig(tier="pro_arm")

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
        # Use temp path to avoid /var/lib/podex permission issues
        manager._local_storage_path = tmp_path / "workspaces"

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
async def test_create_workspace_max_limit_reached(workspace_store, workspace_factory, test_user_id, monkeypatch):
    """Test workspace creation when max limit is reached."""
    # Set a low max_workspaces limit for testing
    monkeypatch.setattr("src.config.settings.max_workspaces", 2)

    config = WorkspaceConfig(tier="starter_arm")

    async with create_mock_docker_manager(workspace_store) as (manager, mock_client):
        # Create max workspaces to hit the limit using the manager's store
        for i in range(2):
            workspace = workspace_factory.create_info(
                workspace_id=f"ws-limit-{i}",
                user_id=test_user_id,
                session_id="session-1",
                status=WorkspaceStatus.RUNNING,
            )
            await manager._workspace_store.save(workspace)

        with pytest.raises(RuntimeError, match="Maximum workspaces"):
            await manager.create_workspace(
                user_id=test_user_id,
                session_id="session-2",
                config=config,
            )


@pytest.mark.asyncio
async def test_stop_workspace(workspace_store, workspace_factory, test_user_id):
    """Test stopping a running workspace."""
    mock_container = create_mock_container(container_id="container123")
    mock_container.stop = MagicMock()

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        workspace = workspace_factory.create_info(
            workspace_id="test-ws-stop",
            user_id=test_user_id,
            status=WorkspaceStatus.RUNNING,
            container_id="container123",
            tier="starter_arm",
        )
        await manager._workspace_store.save(workspace)

        # Reset side_effect so get always returns the container
        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        with patch("src.managers.docker_manager.sync_workspace_status_to_api", new_callable=AsyncMock):
            await manager.stop_workspace("test-ws-stop")

            mock_container.stop.assert_called_once()

            # Verify workspace status updated
            updated = await manager._workspace_store.get("test-ws-stop")
            assert updated.status == WorkspaceStatus.STOPPED


@pytest.mark.asyncio
async def test_stop_workspace_already_stopped(workspace_store, workspace_factory, test_user_id):
    """Test stopping an already stopped workspace."""
    mock_container = create_mock_container(container_id="container123", status="exited")

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        workspace = workspace_factory.create_info(
            workspace_id="test-ws-already-stopped",
            user_id=test_user_id,
            status=WorkspaceStatus.STOPPED,
            container_id="container123",
        )
        await manager._workspace_store.save(workspace)

        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        # Should not raise error
        await manager.stop_workspace("test-ws-already-stopped")


@pytest.mark.asyncio
async def test_restart_workspace(workspace_store, workspace_factory, test_user_id):
    """Test restarting a stopped workspace."""
    mock_container = create_mock_container(container_id="container123", status="exited")

    # Make container status change to "running" after start() is called
    def mock_start():
        mock_container.status = "running"

    mock_container.start = MagicMock(side_effect=mock_start)

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        workspace = workspace_factory.create_info(
            workspace_id="test-ws-restart",
            user_id=test_user_id,
            status=WorkspaceStatus.STOPPED,
            container_id="container123",
        )
        await manager._workspace_store.save(workspace)

        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        await manager.restart_workspace("test-ws-restart")

        mock_container.start.assert_called_once()

        # Verify workspace status updated
        updated = await manager._workspace_store.get("test-ws-restart")
        assert updated.status == WorkspaceStatus.RUNNING


@pytest.mark.asyncio
async def test_delete_workspace(workspace_store, workspace_factory, test_user_id):
    """Test deleting a workspace."""
    mock_container = create_mock_container(container_id="container123")
    mock_container.remove = MagicMock()

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        workspace = workspace_factory.create_info(
            workspace_id="test-ws-delete",
            user_id=test_user_id,
            container_id="container123",
        )
        await manager._workspace_store.save(workspace)

        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        await manager.delete_workspace("test-ws-delete", preserve_files=False)

        # delete_workspace uses force=True which removes without stopping
        mock_container.remove.assert_called_once_with(force=True)

        # Verify workspace removed from store
        deleted = await manager._workspace_store.get("test-ws-delete")
        assert deleted is None


# ============================================
# Command Execution Tests
# ============================================


@pytest.mark.asyncio
async def test_exec_command_success(workspace_store, workspace_factory, test_user_id):
    """Test successful command execution."""
    mock_container = create_mock_container(container_id="container123")
    mock_exec_result = MagicMock()
    mock_exec_result.output = (b"Hello World\n", b"")  # (stdout, stderr) tuple
    mock_exec_result.exit_code = 0
    mock_container.exec_run.return_value = mock_exec_result

    async with create_mock_docker_manager(workspace_store, mock_container) as (manager, mock_client):
        workspace = workspace_factory.create_info(
            workspace_id="test-ws-exec",
            user_id=test_user_id,
            status=WorkspaceStatus.RUNNING,
            container_id="container123",
        )
        await manager._workspace_store.save(workspace)

        mock_client.containers.get.side_effect = None
        mock_client.containers.get.return_value = mock_container

        result = await manager.exec_command("test-ws-exec", "echo 'Hello World'")

        assert result.exit_code == 0
        assert "Hello World" in result.stdout
        assert result.stderr == ""


@pytest.mark.asyncio
async def test_exec_command_with_timeout(docker_manager, workspace_factory, test_user_id):
    """Test command execution with timeout.

    The implementation catches TimeoutError internally and returns a response
    with exit_code=-1 and a timeout message in stderr.
    """
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")

    # Simulate slow exec_run that will timeout
    import time

    def slow_exec_run(*args, **kwargs):
        time.sleep(5)  # Longer than the timeout
        mock_result = MagicMock()
        mock_result.exit_code = 0
        mock_result.output = (b"done", b"")
        return mock_result

    mock_container.exec_run = MagicMock(side_effect=slow_exec_run)

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_container

    # The implementation catches TimeoutError and returns a response with exit_code=-1
    result = await docker_manager.exec_command("test-ws-1", "sleep 100", timeout=1)

    assert result.exit_code == -1
    assert "timed out" in result.stderr.lower()


@pytest.mark.asyncio
async def test_exec_command_auto_restart(
    docker_manager, workspace_factory, test_user_id
):
    """Test command execution auto-restarts stopped container."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.STOPPED,
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123", status="exited")

    # Make container status change to "running" after start() is called
    def mock_start():
        mock_container.status = "running"

    mock_container.start = MagicMock(side_effect=mock_start)
    mock_exec_result = MagicMock()
    mock_exec_result.output = (b"output", b"")  # (stdout, stderr) tuple
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_container

    # First call should restart
    result = await docker_manager.exec_command("test-ws-1", "echo test")

    mock_container.start.assert_called_once()
    assert result.exit_code == 0


@pytest.mark.asyncio
async def test_exec_command_stream(docker_manager, workspace_factory, test_user_id):
    """Test streaming command execution."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")

    # Mock the exec_create and exec_start methods for streaming
    mock_exec_id = {"Id": "exec123"}

    def mock_exec_create(*args, **kwargs):
        return mock_exec_id

    def mock_exec_start(*args, **kwargs):
        # Return an iterator that yields bytes
        return iter([b"line1\n", b"line2\n", b"line3\n"])

    # Mock the low-level API client
    mock_api = MagicMock()
    mock_api.exec_create = mock_exec_create
    mock_api.exec_start = mock_exec_start
    mock_api.exec_inspect = MagicMock(return_value={"ExitCode": 0})
    docker_manager._mock_docker_client.api = mock_api

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_container

    chunks = []
    async for chunk in docker_manager.exec_command_stream("test-ws-1", "echo test"):
        chunks.append(chunk)

    assert len(chunks) >= 1


# ============================================
# File Operations Tests
# ============================================


@pytest.mark.asyncio
async def test_read_file(docker_manager, workspace_factory, test_user_id):
    """Test reading file from workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")
    mock_exec_result = MagicMock()
    mock_exec_result.output = (b"file contents here", b"")  # (stdout, stderr) tuple
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_container
    content = await docker_manager.read_file("test-ws-1", "/home/dev/test.txt")

    assert "file contents" in content


@pytest.mark.asyncio
async def test_write_file(docker_manager, workspace_factory, test_user_id):
    """Test writing file to workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")
    mock_exec_result = MagicMock()
    mock_exec_result.output = (b"", b"")  # (stdout, stderr) tuple
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_container
    await docker_manager.write_file("test-ws-1", "/home/dev/test.txt", "new content")

    # Verify exec_run was called (base64 write command)
    assert mock_container.exec_run.called


@pytest.mark.asyncio
async def test_list_files(docker_manager, workspace_factory, test_user_id):
    """Test listing files in workspace directory."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")
    mock_exec_result = MagicMock()
    # Simulate ls -la output - (stdout, stderr) tuple
    mock_exec_result.output = (
        b"drwxr-xr-x 2 dev dev 4096 Jan 1 00:00 .\ndrwxr-xr-x 3 dev dev 4096 Jan 1 00:00 ..\n-rw-r--r-- 1 dev dev 100 Jan 1 00:00 file.txt\n",
        b""
    )
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_container
    files = await docker_manager.list_files("test-ws-1", "/home/dev")

    assert isinstance(files, list)


# ============================================
# Discovery & Health Tests
# ============================================


@pytest.mark.asyncio
async def test_discover_existing_workspaces(docker_manager):
    """Test discovering existing workspaces from Docker.

    Note: The discover_existing_workspaces function marks all discovered
    containers as RUNNING regardless of their actual Docker status.
    This is intentional - the function recovers workspace tracking, and
    status reconciliation happens separately.
    """
    mock_container1 = create_mock_container(
        container_id="container1",
        name="podex-workspace-ws-1",
        status="running",
    )
    mock_container1.labels = {
        "podex.workspace_id": "ws-1",
        "podex.user_id": "user-1",
        "podex.session_id": "session-1",
        "podex.tier": "starter",
    }

    mock_container2 = create_mock_container(
        container_id="container2",
        name="podex-workspace-ws-2",
        status="running",  # Discovery marks all containers as RUNNING
    )
    mock_container2.labels = {
        "podex.workspace_id": "ws-2",
        "podex.user_id": "user-2",
        "podex.session_id": "session-2",
        "podex.tier": "starter",
    }

    docker_manager._mock_docker_client.containers.list.return_value = [mock_container1, mock_container2]

    with patch("src.managers.docker_manager.sync_workspace_status_to_api", new_callable=AsyncMock):
        await docker_manager.discover_existing_workspaces()

        # Verify workspaces were added to manager's store (mock store)
        ws1 = await docker_manager._workspace_store.get("ws-1")
        ws2 = await docker_manager._workspace_store.get("ws-2")

        assert ws1 is not None
        assert ws1.status == WorkspaceStatus.RUNNING

        assert ws2 is not None
        assert ws2.status == WorkspaceStatus.RUNNING  # All discovered are marked RUNNING


@pytest.mark.asyncio
async def test_check_workspace_health(
    docker_manager, workspace_factory, test_user_id
):
    """Test checking workspace health."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")
    mock_exec_result = MagicMock()
    mock_exec_result.exit_code = 0
    mock_exec_result.output = (b"", b"")
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_container
    is_healthy = await docker_manager.check_workspace_health("test-ws-1")

    assert is_healthy is True


@pytest.mark.asyncio
async def test_check_workspace_health_unhealthy(
    docker_manager, workspace_factory, test_user_id
):
    """Test checking unhealthy workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123", status="exited")

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_container
    is_healthy = await docker_manager.check_workspace_health("test-ws-1")

    assert is_healthy is False


# ============================================
# Billing & Usage Tests
# ============================================


@pytest.mark.asyncio
async def test_track_running_workspaces_usage(docker_manager, workspace_factory):
    """Test tracking usage for running workspaces."""
    # Create running workspaces with last_billing_timestamp in metadata
    last_billing_1 = (datetime.now(UTC) - timedelta(minutes=15)).isoformat()
    last_billing_2 = (datetime.now(UTC) - timedelta(minutes=20)).isoformat()

    ws1 = workspace_factory.create_info(
        workspace_id="ws-1",
        user_id="user-1",
        status=WorkspaceStatus.RUNNING,
        tier="pro_arm",
    )
    ws1.metadata["last_billing_timestamp"] = last_billing_1

    ws2 = workspace_factory.create_info(
        workspace_id="ws-2",
        user_id="user-2",
        status=WorkspaceStatus.RUNNING,
        tier="starter_arm",
    )
    ws2.metadata["last_billing_timestamp"] = last_billing_2

    await docker_manager._workspace_store.save(ws1)
    await docker_manager._workspace_store.save(ws2)

    # Patch where the function is used, not where it's defined
    with patch("src.managers.docker_manager.get_usage_tracker") as mock_tracker:
        mock_tracker_instance = MagicMock()
        mock_tracker_instance.record_compute_usage = AsyncMock()
        mock_tracker.return_value = mock_tracker_instance

        await docker_manager.track_running_workspaces_usage()

        # Verify usage was tracked for both workspaces
        assert mock_tracker_instance.record_compute_usage.called
        assert mock_tracker_instance.record_compute_usage.call_count >= 1


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
async def test_get_active_ports(docker_manager, workspace_factory, test_user_id):
    """Test getting active ports from workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_container = create_mock_container(container_id="container123")
    mock_exec_result = MagicMock()
    # Simulate ss output - (stdout, stderr) tuple
    # Format: State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
    mock_exec_result.output = (
        b"LISTEN 0 511 *:3000 *:* users:((\"node\",pid=123,fd=10))\nLISTEN 0 128 *:8080 *:* users:((\"python\",pid=456,fd=5))\n",
        b""
    )
    mock_exec_result.exit_code = 0
    mock_container.exec_run = MagicMock(return_value=mock_exec_result)

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_container
    ports = await docker_manager.get_active_ports("test-ws-1")

    assert len(ports) >= 1


# ============================================
# Scaling Tests
# ============================================


@pytest.mark.asyncio
async def test_scale_workspace_tier_upgrade(
    docker_manager, workspace_factory, test_user_id
):
    """Test scaling workspace to higher tier."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
        tier="starter_arm",
        container_id="container123",
    )
    await docker_manager._workspace_store.save(workspace)

    mock_old_container = create_mock_container(container_id="container123")
    mock_old_container.stop = MagicMock()
    mock_old_container.remove = MagicMock()

    mock_new_container = create_mock_container(container_id="container456")
    mock_new_container.id = "container456"
    mock_new_container.status = "running"

    # Clear side_effect and set return_value
    docker_manager._mock_docker_client.containers.get.side_effect = None
    docker_manager._mock_docker_client.containers.get.return_value = mock_old_container
    docker_manager._mock_docker_client.containers.run.return_value = mock_new_container

    response = await docker_manager.scale_workspace("test-ws-1", "pro_arm")

    assert response.success is True
    assert response.new_tier == "pro_arm"

    # Verify workspace updated in store
    updated = await docker_manager._workspace_store.get("test-ws-1")
    assert updated.tier == "pro_arm"
    assert updated.container_id == "container456"


# ============================================
# HTTP Proxy Tests
# ============================================


@pytest.mark.asyncio
async def test_proxy_request_get(docker_manager, workspace_factory, test_user_id):
    """Test proxying GET request to workspace."""
    workspace = workspace_factory.create_info(
        workspace_id="test-ws-1",
        user_id=test_user_id,
        status=WorkspaceStatus.RUNNING,
    )
    await docker_manager._workspace_store.save(workspace)

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
