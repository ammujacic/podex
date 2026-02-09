"""Tests for checkpoint modules.

Tests cover:
- CheckpointManager
- Checkpoint and FileChange dataclasses
"""

import pytest
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestCheckpointModuleImports:
    """Test checkpoint module imports."""

    def test_checkpoints_module_exists(self):
        """Test checkpoints module can be imported."""
        from src import checkpoints
        assert checkpoints is not None

    def test_manager_module_exists(self):
        """Test manager module can be imported."""
        from src.checkpoints import manager
        assert manager is not None


class TestCheckpointManager:
    """Test CheckpointManager class."""

    def test_checkpoint_manager_class_exists(self):
        """Test CheckpointManager class exists."""
        from src.checkpoints.manager import CheckpointManager
        assert CheckpointManager is not None

    def test_checkpoint_dataclass_exists(self):
        """Test Checkpoint dataclass exists."""
        from src.checkpoints.manager import Checkpoint
        assert Checkpoint is not None

    def test_file_change_dataclass_exists(self):
        """Test FileChange dataclass exists."""
        from src.checkpoints.manager import FileChange
        assert FileChange is not None


class TestFileChangeDataclass:
    """Test FileChange dataclass."""

    def test_file_change_creation(self):
        """Test FileChange creation."""
        from src.checkpoints.manager import FileChange

        change = FileChange(
            file_path="src/test.py",
            change_type="modify",
            content_before="old content",
            content_after="new content",
            lines_added=5,
            lines_removed=2,
        )
        assert change.file_path == "src/test.py"
        assert change.change_type == "modify"
        assert change.content_before == "old content"
        assert change.content_after == "new content"
        assert change.lines_added == 5
        assert change.lines_removed == 2

    def test_file_change_defaults(self):
        """Test FileChange default values."""
        from src.checkpoints.manager import FileChange

        change = FileChange(
            file_path="test.py",
            change_type="create",
            content_before=None,
            content_after="new content",
        )
        assert change.lines_added == 0
        assert change.lines_removed == 0


class TestCheckpointDataclass:
    """Test Checkpoint dataclass."""

    def test_checkpoint_creation(self):
        """Test Checkpoint creation."""
        from src.checkpoints.manager import Checkpoint

        checkpoint = Checkpoint(
            id="cp-123",
            session_id="session-456",
            workspace_id="ws-789",
            agent_id="agent-111",
            checkpoint_number=1,
            description="Test checkpoint",
            action_type="file_edit",
        )
        assert checkpoint.id == "cp-123"
        assert checkpoint.session_id == "session-456"
        assert checkpoint.workspace_id == "ws-789"
        assert checkpoint.agent_id == "agent-111"
        assert checkpoint.checkpoint_number == 1
        assert checkpoint.description == "Test checkpoint"
        assert checkpoint.action_type == "file_edit"
        assert checkpoint.status == "active"
        assert checkpoint.files == []
        assert checkpoint.metadata == {}


class TestCheckpointManagerMethods:
    """Test CheckpointManager class methods."""

    @pytest.fixture
    def manager(self, tmp_path):
        """Create a checkpoint manager with temp directory."""
        from src.checkpoints.manager import CheckpointManager
        return CheckpointManager(str(tmp_path))

    @pytest.fixture
    def setup_test_file(self, tmp_path):
        """Create a test file in tmp_path."""
        test_file = tmp_path / "test.py"
        test_file.write_text("line 1\nline 2\n")
        return test_file

    def test_manager_initialization(self, manager, tmp_path):
        """Test CheckpointManager initialization."""
        from pathlib import Path
        assert manager.workspace_path == Path(tmp_path)
        assert manager.checkpoints == {}

    def test_get_next_checkpoint_number(self, manager):
        """Test _get_next_checkpoint_number method."""
        assert manager._get_next_checkpoint_number("session-1") == 1
        assert manager._get_next_checkpoint_number("session-1") == 2
        assert manager._get_next_checkpoint_number("session-2") == 1
        assert manager._get_next_checkpoint_number("session-1") == 3

    def test_count_lines(self, manager):
        """Test _count_lines method."""
        assert manager._count_lines(None) == 0
        assert manager._count_lines("") == 0
        assert manager._count_lines("line 1") == 1
        assert manager._count_lines("line 1\nline 2\nline 3") == 3

    def test_read_file_content(self, manager, tmp_path):
        """Test _read_file_content method."""
        # Create a test file
        test_file = tmp_path / "test.txt"
        test_file.write_text("test content")

        content = manager._read_file_content("test.txt")
        assert content == "test content"

    def test_read_file_content_not_found(self, manager):
        """Test _read_file_content for non-existent file."""
        content = manager._read_file_content("nonexistent.txt")
        assert content is None

    def test_create_checkpoint_before_edit_new_file(self, manager):
        """Test creating checkpoint before editing a new file."""
        checkpoint = manager.create_checkpoint_before_edit(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_path="new_file.py",
            new_content="new content\n",
            description="Create new file",
        )

        assert checkpoint.session_id == "session-1"
        assert checkpoint.action_type == "file_create"
        assert len(checkpoint.files) == 1
        assert checkpoint.files[0].change_type == "create"
        assert checkpoint.files[0].content_before is None
        assert checkpoint.files[0].content_after == "new content\n"

    def test_create_checkpoint_before_edit_existing_file(self, manager, setup_test_file):
        """Test creating checkpoint before editing an existing file."""
        checkpoint = manager.create_checkpoint_before_edit(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_path="test.py",
            new_content="modified content\n",
            description="Modify file",
        )

        assert checkpoint.action_type == "file_edit"
        assert checkpoint.files[0].change_type == "modify"
        assert checkpoint.files[0].content_before == "line 1\nline 2\n"
        assert checkpoint.files[0].content_after == "modified content\n"

    def test_create_checkpoint_before_edit_default_description(self, manager):
        """Test checkpoint with default description."""
        checkpoint = manager.create_checkpoint_before_edit(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_path="test.py",
            new_content="content",
        )
        assert checkpoint.description == "Edit test.py"

    def test_create_checkpoint_before_delete(self, manager, setup_test_file):
        """Test creating checkpoint before deleting a file."""
        checkpoint = manager.create_checkpoint_before_delete(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_path="test.py",
            description="Delete file",
        )

        assert checkpoint is not None
        assert checkpoint.action_type == "file_delete"
        assert checkpoint.files[0].change_type == "delete"
        assert checkpoint.files[0].content_before == "line 1\nline 2\n"
        assert checkpoint.files[0].content_after is None

    def test_create_checkpoint_before_delete_nonexistent(self, manager):
        """Test creating checkpoint for deleting non-existent file."""
        checkpoint = manager.create_checkpoint_before_delete(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_path="nonexistent.py",
        )
        assert checkpoint is None

    def test_create_batch_checkpoint(self, manager, tmp_path):
        """Test creating batch checkpoint."""
        # Create an existing file
        existing = tmp_path / "existing.py"
        existing.write_text("old content")

        checkpoint = manager.create_batch_checkpoint(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_changes=[
                ("existing.py", "new content"),  # Modify
                ("new_file.py", "brand new"),  # Create
            ],
            description="Batch edit",
        )

        assert checkpoint.action_type == "batch_edit"
        assert len(checkpoint.files) == 2

        # Check modify
        modify_change = next(c for c in checkpoint.files if c.file_path == "existing.py")
        assert modify_change.change_type == "modify"

        # Check create
        create_change = next(c for c in checkpoint.files if c.file_path == "new_file.py")
        assert create_change.change_type == "create"

    def test_create_batch_checkpoint_with_delete(self, manager, tmp_path):
        """Test batch checkpoint with delete."""
        # Create a file to delete
        to_delete = tmp_path / "to_delete.py"
        to_delete.write_text("delete me")

        checkpoint = manager.create_batch_checkpoint(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_changes=[
                ("to_delete.py", None),  # Delete
            ],
        )

        assert len(checkpoint.files) == 1
        assert checkpoint.files[0].change_type == "delete"

    def test_create_batch_checkpoint_default_description(self, manager):
        """Test batch checkpoint default description."""
        checkpoint = manager.create_batch_checkpoint(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_changes=[("file1.py", "content"), ("file2.py", "content")],
        )
        assert "2 files" in checkpoint.description

    def test_get_checkpoints(self, manager):
        """Test get_checkpoints method."""
        # Create some checkpoints
        manager.create_checkpoint_before_edit("session-1", "ws-1", "agent-1", "file1.py", "c1")
        manager.create_checkpoint_before_edit("session-1", "ws-1", "agent-1", "file2.py", "c2")
        manager.create_checkpoint_before_edit("session-1", "ws-1", "agent-2", "file3.py", "c3")

        # Get all checkpoints
        all_checkpoints = manager.get_checkpoints("session-1")
        assert len(all_checkpoints) == 3

        # Filter by agent
        agent1_checkpoints = manager.get_checkpoints("session-1", agent_id="agent-1")
        assert len(agent1_checkpoints) == 2

    def test_get_checkpoints_with_limit(self, manager):
        """Test get_checkpoints with limit."""
        # Create many checkpoints
        for i in range(10):
            manager.create_checkpoint_before_edit("session-1", "ws-1", "agent-1", f"file{i}.py", f"c{i}")

        limited = manager.get_checkpoints("session-1", limit=5)
        assert len(limited) == 5

        # Should return most recent first
        assert limited[0]["checkpoint_number"] == 10

    def test_get_checkpoints_empty_session(self, manager):
        """Test get_checkpoints for non-existent session."""
        checkpoints = manager.get_checkpoints("nonexistent")
        assert checkpoints == []

    def test_get_checkpoint_diff(self, manager, setup_test_file):
        """Test get_checkpoint_diff method."""
        checkpoint = manager.create_checkpoint_before_edit(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_path="test.py",
            new_content="modified\n",
        )

        diff = manager.get_checkpoint_diff("session-1", checkpoint.id)

        assert diff["id"] == checkpoint.id
        assert diff["description"] == checkpoint.description
        assert len(diff["files"]) == 1
        assert diff["files"][0]["content_before"] == "line 1\nline 2\n"
        assert diff["files"][0]["content_after"] == "modified\n"

    def test_get_checkpoint_diff_not_found(self, manager):
        """Test get_checkpoint_diff for non-existent checkpoint."""
        diff = manager.get_checkpoint_diff("session-1", "nonexistent")
        assert "error" in diff
        assert "not found" in diff["error"]

    def test_restore_checkpoint_modify(self, manager, tmp_path):
        """Test restore_checkpoint for modified file."""
        # Create and modify a file
        test_file = tmp_path / "test.py"
        test_file.write_text("original content")

        checkpoint = manager.create_checkpoint_before_edit(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_path="test.py",
            new_content="modified content",
        )

        # Simulate the file being modified
        test_file.write_text("modified content")

        # Restore
        result = manager.restore_checkpoint("session-1", checkpoint.id)

        assert result["success"] is True
        assert test_file.read_text() == "original content"
        assert checkpoint.status == "restored"

    def test_restore_checkpoint_create(self, manager, tmp_path):
        """Test restore_checkpoint for created file (removes it)."""
        checkpoint = manager.create_checkpoint_before_edit(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_path="new_file.py",
            new_content="new content",
        )

        # Create the file
        new_file = tmp_path / "new_file.py"
        new_file.write_text("new content")

        # Restore (should remove the file)
        result = manager.restore_checkpoint("session-1", checkpoint.id)

        assert result["success"] is True
        assert not new_file.exists()

    def test_restore_checkpoint_delete(self, manager, tmp_path):
        """Test restore_checkpoint for deleted file (restores it)."""
        # Create a file
        test_file = tmp_path / "test.py"
        test_file.write_text("original content")

        checkpoint = manager.create_checkpoint_before_delete(
            session_id="session-1",
            workspace_id="ws-1",
            agent_id="agent-1",
            file_path="test.py",
        )

        # Delete the file
        test_file.unlink()

        # Restore (should recreate the file)
        result = manager.restore_checkpoint("session-1", checkpoint.id)

        assert result["success"] is True
        assert test_file.exists()
        assert test_file.read_text() == "original content"

    def test_restore_checkpoint_not_found(self, manager):
        """Test restore_checkpoint for non-existent checkpoint."""
        result = manager.restore_checkpoint("session-1", "nonexistent")
        assert result["success"] is False
        assert "not found" in result["error"]

    def test_restore_checkpoint_marks_superseded(self, manager, tmp_path):
        """Test that later checkpoints are marked superseded."""
        # Create first file and checkpoint
        test_file = tmp_path / "test.py"
        test_file.write_text("version 1")

        cp1 = manager.create_checkpoint_before_edit("session-1", "ws-1", "agent-1", "test.py", "version 2")
        test_file.write_text("version 2")

        cp2 = manager.create_checkpoint_before_edit("session-1", "ws-1", "agent-1", "test.py", "version 3")
        test_file.write_text("version 3")

        # Restore to first checkpoint
        manager.restore_checkpoint("session-1", cp1.id)

        assert cp1.status == "restored"
        assert cp2.status == "superseded"

    def test_clear_session_checkpoints(self, manager):
        """Test clear_session_checkpoints method."""
        # Create checkpoints for multiple sessions
        manager.create_checkpoint_before_edit("session-1", "ws-1", "agent-1", "file1.py", "c1")
        manager.create_checkpoint_before_edit("session-1", "ws-1", "agent-1", "file2.py", "c2")
        manager.create_checkpoint_before_edit("session-2", "ws-2", "agent-2", "file3.py", "c3")

        # Clear session-1
        manager.clear_session_checkpoints("session-1")

        assert manager.get_checkpoints("session-1") == []
        assert len(manager.get_checkpoints("session-2")) == 1

    def test_clear_session_checkpoints_nonexistent(self, manager):
        """Test clear_session_checkpoints for non-existent session."""
        # Should not raise
        manager.clear_session_checkpoints("nonexistent")


class TestGetCheckpointManager:
    """Test get_checkpoint_manager function."""

    def test_get_checkpoint_manager_singleton(self, tmp_path):
        """Test that same workspace returns same manager."""
        from src.checkpoints.manager import get_checkpoint_manager, _checkpoint_managers

        # Reset global state
        _checkpoint_managers.clear()

        manager1 = get_checkpoint_manager(str(tmp_path))
        manager2 = get_checkpoint_manager(str(tmp_path))

        assert manager1 is manager2

        # Clean up
        _checkpoint_managers.clear()

    def test_get_checkpoint_manager_different_workspaces(self, tmp_path):
        """Test that different workspaces get different managers."""
        from src.checkpoints.manager import get_checkpoint_manager, _checkpoint_managers

        _checkpoint_managers.clear()

        ws1 = tmp_path / "workspace1"
        ws2 = tmp_path / "workspace2"
        ws1.mkdir()
        ws2.mkdir()

        manager1 = get_checkpoint_manager(str(ws1))
        manager2 = get_checkpoint_manager(str(ws2))

        assert manager1 is not manager2

        # Clean up
        _checkpoint_managers.clear()
