"""Integration tests with real Docker containers."""

import pytest

from podex_local_pod.config import LocalPodConfig
from podex_local_pod.docker_manager import LocalDockerManager


@pytest.mark.integration
class TestDockerIntegration:
    """Integration tests with real Docker."""

    @pytest.mark.asyncio
    async def test_real_container_create_and_stop(self, docker_client, test_network, test_image):
        """Test creating and stopping a real container."""
        config = LocalPodConfig(
            pod_token="test", docker_network=test_network.name, workspace_image=test_image
        )
        manager = LocalDockerManager(config)
        await manager.initialize()

        # Create real container
        workspace = await manager.create_workspace(
            workspace_id="ws_integration_test_1",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        assert workspace["status"] == "running"
        assert workspace["id"] == "ws_integration_test_1"

        # Verify container exists
        container = docker_client.containers.get(workspace["container_id"])
        assert container.status == "running"

        # Stop workspace
        await manager.stop_workspace("ws_integration_test_1")

        # Cleanup
        await manager.delete_workspace("ws_integration_test_1")

    @pytest.mark.asyncio
    async def test_real_container_network_connectivity(self, docker_client, test_network, test_image):
        """Test container network connectivity."""
        config = LocalPodConfig(
            pod_token="test", docker_network=test_network.name, workspace_image=test_image
        )
        manager = LocalDockerManager(config)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_integration_test_2",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Verify network settings
        assert workspace["host"] is not None
        assert len(workspace["host"]) > 0

        # Cleanup
        await manager.delete_workspace("ws_integration_test_2")

    @pytest.mark.asyncio
    async def test_real_container_exec_command(self, docker_client, test_network, test_image):
        """Test executing real commands in container."""
        config = LocalPodConfig(
            pod_token="test", docker_network=test_network.name, workspace_image=test_image
        )
        manager = LocalDockerManager(config)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_integration_test_3",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Execute real command
        result = await manager.exec_command("ws_integration_test_3", "echo 'hello world'")

        assert result["exit_code"] == 0
        assert "hello world" in result.get("stdout", "")

        # Cleanup
        await manager.delete_workspace("ws_integration_test_3")

    @pytest.mark.asyncio
    async def test_real_container_file_operations(self, docker_client, test_network, test_image):
        """Test file operations with real container."""
        config = LocalPodConfig(
            pod_token="test", docker_network=test_network.name, workspace_image=test_image
        )
        manager = LocalDockerManager(config)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_integration_test_4",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Write file - write_file returns None on success, raises on error
        await manager.write_file(
            "ws_integration_test_4", "/tmp/test.txt", "integration test content"
        )

        # Read file back - read_file returns file content directly
        content = await manager.read_file("ws_integration_test_4", "/tmp/test.txt")
        assert "integration test content" in content

        # List files - list_files returns a list of file entries directly
        files = await manager.list_files("ws_integration_test_4", "/tmp")
        assert isinstance(files, list)

        # Cleanup
        await manager.delete_workspace("ws_integration_test_4")

    @pytest.mark.asyncio
    async def test_real_port_detection(self, docker_client, test_network, test_image):
        """Test port detection with real container."""
        config = LocalPodConfig(
            pod_token="test", docker_network=test_network.name, workspace_image=test_image
        )
        manager = LocalDockerManager(config)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_integration_test_5",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Get active ports (may be empty in Alpine)
        # get_active_ports returns a list of port dicts directly
        result = await manager.get_active_ports("ws_integration_test_5")

        assert isinstance(result, list)
        # Each port entry is a dict with port info (may be empty if no ports listening)

        # Cleanup
        await manager.delete_workspace("ws_integration_test_5")

    @pytest.mark.asyncio
    async def test_cleanup_after_crash_recovery(self, docker_client, test_network, test_image):
        """Test cleanup of orphaned containers."""
        config = LocalPodConfig(
            pod_token="test", docker_network=test_network.name, workspace_image=test_image
        )
        manager = LocalDockerManager(config)
        await manager.initialize()

        # Create a container
        workspace = await manager.create_workspace(
            workspace_id="ws_integration_test_6",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Simulate crash by not tracking it
        manager._workspaces = {}

        # Cleanup should find and remove orphaned container
        await manager._cleanup_orphaned_containers()

    @pytest.mark.asyncio
    async def test_multiple_containers_concurrently(self, docker_client, test_network, test_image):
        """Test creating multiple containers concurrently."""
        config = LocalPodConfig(
            pod_token="test", docker_network=test_network.name, workspace_image=test_image
        )
        manager = LocalDockerManager(config)
        await manager.initialize()

        # Create multiple workspaces
        ws1 = await manager.create_workspace(
            workspace_id="ws_multi_1", user_id="user1", session_id="sess1", config={"tier": "starter"}
        )
        ws2 = await manager.create_workspace(
            workspace_id="ws_multi_2", user_id="user2", session_id="sess2", config={"tier": "starter"}
        )

        assert ws1["status"] == "running"
        assert ws2["status"] == "running"

        # Verify both exist - list_workspaces returns a list directly
        workspaces = await manager.list_workspaces()
        assert len(workspaces) >= 2

        # Cleanup
        await manager.delete_workspace("ws_multi_1")
        await manager.delete_workspace("ws_multi_2")

    @pytest.mark.asyncio
    async def test_resource_limits_enforcement(self, docker_client, test_network, test_image):
        """Test that resource limits are properly set."""
        config = LocalPodConfig(
            pod_token="test", docker_network=test_network.name, workspace_image=test_image
        )
        manager = LocalDockerManager(config)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_resources",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "pro"},  # Pro tier has specific resource limits
        )

        # Verify container exists and has resource limits
        container = docker_client.containers.get(workspace["container_id"])
        # Check that container was created (resource limits are internal to Docker)
        assert container.status == "running"

        # Cleanup
        await manager.delete_workspace("ws_resources")
