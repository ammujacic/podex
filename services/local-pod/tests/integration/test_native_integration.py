"""Integration tests for native mode execution (no Docker)."""

import os
import shutil
import tempfile
from pathlib import Path

import pytest

from podex_local_pod.config import LocalPodConfig, MountConfig, NativeConfig
from podex_local_pod.native_manager import NativeManager


@pytest.fixture
def temp_workspace_dir():
    """Create a temporary workspace directory for testing."""
    temp_dir = tempfile.mkdtemp(prefix="podex_native_test_")
    yield temp_dir
    # Cleanup
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def temp_mount_dir():
    """Create a temporary mount directory for testing."""
    temp_dir = tempfile.mkdtemp(prefix="podex_mount_test_")
    # Create some test files in the mount
    Path(temp_dir, "existing_file.txt").write_text("pre-existing content")
    Path(temp_dir, "subdir").mkdir()
    Path(temp_dir, "subdir", "nested.txt").write_text("nested content")
    yield temp_dir
    # Cleanup
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def native_config_allowlist(temp_workspace_dir, temp_mount_dir):
    """Create native mode config with allowlist security."""
    return LocalPodConfig(
        pod_token="test_token",
        mode="native",
        native=NativeConfig(
            workspace_dir=temp_workspace_dir,
            security="allowlist",
        ),
        mounts=[
            MountConfig(path=temp_mount_dir, mode="rw", label="Test Mount"),
        ],
    )


@pytest.fixture
def native_config_unrestricted(temp_workspace_dir):
    """Create native mode config with unrestricted security."""
    return LocalPodConfig(
        pod_token="test_token",
        mode="native",
        native=NativeConfig(
            workspace_dir=temp_workspace_dir,
            security="unrestricted",
        ),
        mounts=[],
    )


@pytest.mark.integration
class TestNativeIntegration:
    """Integration tests for native mode execution."""

    @pytest.mark.asyncio
    async def test_create_workspace_in_default_dir(self, native_config_allowlist, temp_workspace_dir):
        """Test creating workspace in default workspace directory."""
        manager = NativeManager(native_config_allowlist)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_native_test_1",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        assert workspace["status"] == "running"
        assert workspace["id"] == "ws_native_test_1"
        assert workspace["working_dir"] == str(Path(temp_workspace_dir) / "ws_native_test_1")
        assert Path(workspace["working_dir"]).exists()

        # Cleanup
        await manager.delete_workspace("ws_native_test_1", preserve_files=False)
        assert not Path(workspace["working_dir"]).exists()

    @pytest.mark.asyncio
    async def test_create_workspace_with_mount(
        self, native_config_allowlist, temp_mount_dir
    ):
        """Test creating workspace using an allowed mount path."""
        manager = NativeManager(native_config_allowlist)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_native_test_2",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter", "mount_path": temp_mount_dir},
        )

        assert workspace["status"] == "running"
        # Use Path.resolve() to handle macOS /private symlink
        assert Path(workspace["working_dir"]).resolve() == Path(temp_mount_dir).resolve()
        assert Path(workspace["mount_path"]).resolve() == Path(temp_mount_dir).resolve()

        # Cleanup - should NOT delete mounted directory
        await manager.delete_workspace("ws_native_test_2", preserve_files=True)
        assert Path(temp_mount_dir).exists()  # Mount should still exist

    @pytest.mark.asyncio
    async def test_exec_command_in_workspace(self, native_config_allowlist, temp_workspace_dir):
        """Test executing commands in native workspace."""
        manager = NativeManager(native_config_allowlist)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_native_test_3",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Execute a simple command
        result = await manager.exec_command("ws_native_test_3", "echo 'hello from native'")

        assert result["exit_code"] == 0
        assert "hello from native" in result["stdout"]

        # Execute command that creates a file
        result = await manager.exec_command(
            "ws_native_test_3", "echo 'test content' > created_by_exec.txt"
        )
        assert result["exit_code"] == 0
        assert Path(workspace["working_dir"], "created_by_exec.txt").exists()

        # Cleanup
        await manager.delete_workspace("ws_native_test_3", preserve_files=False)

    @pytest.mark.asyncio
    async def test_file_operations_in_workspace(self, native_config_allowlist, temp_workspace_dir):
        """Test file read/write operations in native workspace."""
        manager = NativeManager(native_config_allowlist)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_native_test_4",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Write a file
        await manager.write_file("ws_native_test_4", "test_file.txt", "native file content")

        # Read it back
        content = await manager.read_file("ws_native_test_4", "test_file.txt")
        assert "native file content" in content

        # List files
        files = await manager.list_files("ws_native_test_4", ".")
        assert any(f["name"] == "test_file.txt" for f in files)

        # Cleanup
        await manager.delete_workspace("ws_native_test_4", preserve_files=False)

    @pytest.mark.asyncio
    async def test_file_operations_with_mount(
        self, native_config_allowlist, temp_mount_dir
    ):
        """Test file operations on mounted directory."""
        manager = NativeManager(native_config_allowlist)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_native_test_5",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter", "mount_path": temp_mount_dir},
        )

        # Read existing file from mount
        content = await manager.read_file("ws_native_test_5", "existing_file.txt")
        assert "pre-existing content" in content

        # Write new file to mount
        await manager.write_file("ws_native_test_5", "new_file.txt", "new content in mount")

        # Verify file was created in mount directory
        assert Path(temp_mount_dir, "new_file.txt").exists()

        # List files including subdirectory
        files = await manager.list_files("ws_native_test_5", ".")
        assert any(f["name"] == "subdir" and f["type"] == "directory" for f in files)

        # List nested directory
        nested_files = await manager.list_files("ws_native_test_5", "subdir")
        assert any(f["name"] == "nested.txt" for f in nested_files)

        # Cleanup
        await manager.delete_workspace("ws_native_test_5", preserve_files=True)

    @pytest.mark.asyncio
    async def test_security_blocks_unauthorized_paths(
        self, native_config_allowlist, temp_workspace_dir
    ):
        """Test that allowlist security blocks access to non-allowed paths."""
        manager = NativeManager(native_config_allowlist)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_native_test_6",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Try to read file outside allowed paths
        with pytest.raises(ValueError, match="Access denied"):
            await manager.read_file("ws_native_test_6", "/etc/passwd")

        # Try to write file outside allowed paths
        with pytest.raises(ValueError, match="Access denied"):
            await manager.write_file("ws_native_test_6", "/tmp/unauthorized.txt", "bad")

        # Cleanup
        await manager.delete_workspace("ws_native_test_6", preserve_files=False)

    @pytest.mark.asyncio
    async def test_unrestricted_mode_allows_all_paths(
        self, native_config_unrestricted, temp_workspace_dir
    ):
        """Test that unrestricted mode allows access to any path."""
        manager = NativeManager(native_config_unrestricted)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_native_test_7",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Should be able to read system files in unrestricted mode
        # Use /etc/shells which exists on both Linux and macOS
        content = await manager.read_file("ws_native_test_7", "/etc/shells")
        assert len(content) > 0

        # Cleanup
        await manager.delete_workspace("ws_native_test_7", preserve_files=False)

    @pytest.mark.asyncio
    async def test_command_timeout(self, native_config_allowlist, temp_workspace_dir):
        """Test command execution timeout."""
        manager = NativeManager(native_config_allowlist)
        await manager.initialize()

        await manager.create_workspace(
            workspace_id="ws_native_test_8",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Execute command with very short timeout
        result = await manager.exec_command(
            "ws_native_test_8", "sleep 10", timeout=1
        )

        assert result["exit_code"] == 124  # Timeout exit code
        assert "timed out" in result["stderr"].lower()

        # Cleanup
        await manager.delete_workspace("ws_native_test_8", preserve_files=False)

    @pytest.mark.asyncio
    async def test_workspace_limit_enforcement(self, native_config_allowlist, temp_workspace_dir):
        """Test that workspace limit is enforced."""
        # Create config with max 2 workspaces
        config = LocalPodConfig(
            pod_token="test_token",
            mode="native",
            max_workspaces=2,
            native=NativeConfig(
                workspace_dir=temp_workspace_dir,
                security="unrestricted",
            ),
        )
        manager = NativeManager(config)
        await manager.initialize()

        # Create two workspaces
        await manager.create_workspace(
            workspace_id="ws_limit_1",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )
        await manager.create_workspace(
            workspace_id="ws_limit_2",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Third workspace should fail
        with pytest.raises(RuntimeError, match="Maximum workspace limit"):
            await manager.create_workspace(
                workspace_id="ws_limit_3",
                user_id="test_user",
                session_id="test_session",
                config={"tier": "starter"},
            )

        # Cleanup
        await manager.delete_workspace("ws_limit_1", preserve_files=False)
        await manager.delete_workspace("ws_limit_2", preserve_files=False)

    @pytest.mark.asyncio
    async def test_workspace_recovery(self, temp_workspace_dir):
        """Test workspace recovery after restart."""
        config = LocalPodConfig(
            pod_token="test_token",
            mode="native",
            native=NativeConfig(
                workspace_dir=temp_workspace_dir,
                security="unrestricted",
            ),
        )
        manager = NativeManager(config)
        await manager.initialize()

        # Create workspace
        workspace = await manager.create_workspace(
            workspace_id="ws_recovery_test",
            user_id="test_user",
            session_id="test_session",
            config={"tier": "starter"},
        )

        # Simulate restart by creating new manager instance
        manager2 = NativeManager(config)
        await manager2.initialize()

        # Workspace should be recovered
        recovered = await manager2.get_workspace("ws_recovery_test")
        assert recovered is not None
        assert recovered["id"] == "ws_recovery_test"
        assert recovered["status"] == "running"

        # Cleanup
        await manager2.delete_workspace("ws_recovery_test", preserve_files=False)

    @pytest.mark.asyncio
    async def test_list_workspaces_filtering(self, native_config_unrestricted):
        """Test filtering workspaces by user_id and session_id."""
        manager = NativeManager(native_config_unrestricted)
        await manager.initialize()

        # Create workspaces for different users/sessions
        await manager.create_workspace(
            workspace_id="ws_user1_sess1",
            user_id="user1",
            session_id="sess1",
            config={},
        )
        await manager.create_workspace(
            workspace_id="ws_user1_sess2",
            user_id="user1",
            session_id="sess2",
            config={},
        )
        await manager.create_workspace(
            workspace_id="ws_user2_sess1",
            user_id="user2",
            session_id="sess1",
            config={},
        )

        # Filter by user_id
        user1_workspaces = await manager.list_workspaces(user_id="user1")
        assert len(user1_workspaces) == 2
        assert all(w["user_id"] == "user1" for w in user1_workspaces)

        # Filter by session_id
        sess1_workspaces = await manager.list_workspaces(session_id="sess1")
        assert len(sess1_workspaces) == 2
        assert all(w["session_id"] == "sess1" for w in sess1_workspaces)

        # Filter by both
        specific = await manager.list_workspaces(user_id="user1", session_id="sess1")
        assert len(specific) == 1
        assert specific[0]["id"] == "ws_user1_sess1"

        # Cleanup
        await manager.delete_workspace("ws_user1_sess1", preserve_files=False)
        await manager.delete_workspace("ws_user1_sess2", preserve_files=False)
        await manager.delete_workspace("ws_user2_sess1", preserve_files=False)

    @pytest.mark.asyncio
    async def test_heartbeat_updates_activity(self, native_config_unrestricted):
        """Test that heartbeat updates last_activity timestamp."""
        manager = NativeManager(native_config_unrestricted)
        await manager.initialize()

        workspace = await manager.create_workspace(
            workspace_id="ws_heartbeat_test",
            user_id="test_user",
            session_id="test_session",
            config={},
        )

        original_activity = workspace["last_activity"]

        # Wait a tiny bit and send heartbeat
        import asyncio
        await asyncio.sleep(0.01)
        await manager.heartbeat("ws_heartbeat_test")

        updated = await manager.get_workspace("ws_heartbeat_test")
        assert updated["last_activity"] > original_activity

        # Cleanup
        await manager.delete_workspace("ws_heartbeat_test", preserve_files=False)
