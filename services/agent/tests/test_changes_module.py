"""Tests for changes module.

Tests cover:
- ChangeSetManager
- File change tracking (ChangeType, FileChange, ChangeSet)
"""

import pytest
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestChangesModuleImports:
    """Test changes module imports."""

    def test_changes_module_exists(self):
        """Test changes module can be imported."""
        from src import changes
        assert changes is not None

    def test_manager_module_exists(self):
        """Test manager module can be imported."""
        from src.changes import manager
        assert manager is not None


class TestChangesManager:
    """Test ChangeSetManager and related classes."""

    def test_change_set_manager_class_exists(self):
        """Test ChangeSetManager class exists."""
        from src.changes.manager import ChangeSetManager
        assert ChangeSetManager is not None

    def test_file_change_dataclass_exists(self):
        """Test FileChange dataclass exists."""
        from src.changes.manager import FileChange
        assert FileChange is not None

    def test_change_set_dataclass_exists(self):
        """Test ChangeSet dataclass exists."""
        from src.changes.manager import ChangeSet
        assert ChangeSet is not None

    def test_change_type_enum_exists(self):
        """Test ChangeType enum exists."""
        from src.changes.manager import ChangeType
        assert ChangeType is not None

    def test_change_type_values(self):
        """Test ChangeType enum values."""
        from src.changes.manager import ChangeType

        # Check common change types exist
        assert ChangeType.CREATE is not None
        assert ChangeType.MODIFY is not None
        assert ChangeType.DELETE is not None

    def test_hunk_status_enum_exists(self):
        """Test HunkStatus enum exists."""
        from src.changes.manager import HunkStatus
        assert HunkStatus is not None

    def test_diff_line_dataclass_exists(self):
        """Test DiffLine dataclass exists."""
        from src.changes.manager import DiffLine
        assert DiffLine is not None

    def test_diff_hunk_dataclass_exists(self):
        """Test DiffHunk dataclass exists."""
        from src.changes.manager import DiffHunk
        assert DiffHunk is not None


class TestChangeTypeEnum:
    """Test ChangeType enum values."""

    def test_change_type_values(self):
        """Test ChangeType enum values."""
        from src.changes.manager import ChangeType

        assert ChangeType.CREATE.value == "create"
        assert ChangeType.MODIFY.value == "modify"
        assert ChangeType.DELETE.value == "delete"


class TestHunkStatusEnum:
    """Test HunkStatus enum values."""

    def test_hunk_status_values(self):
        """Test HunkStatus enum values."""
        from src.changes.manager import HunkStatus

        assert HunkStatus.PENDING.value == "pending"
        assert HunkStatus.SELECTED.value == "selected"
        assert HunkStatus.REJECTED.value == "rejected"


class TestDiffLineDataclass:
    """Test DiffLine dataclass."""

    def test_diff_line_creation(self):
        """Test DiffLine creation."""
        from src.changes.manager import DiffLine

        line = DiffLine(
            type="add",
            content="new content",
            new_line_number=10,
        )
        assert line.type == "add"
        assert line.content == "new content"
        assert line.new_line_number == 10
        assert line.old_line_number is None

    def test_diff_line_context(self):
        """Test DiffLine for context line."""
        from src.changes.manager import DiffLine

        line = DiffLine(
            type="context",
            content="unchanged content",
            old_line_number=5,
            new_line_number=7,
        )
        assert line.type == "context"
        assert line.old_line_number == 5
        assert line.new_line_number == 7


class TestDiffHunkDataclass:
    """Test DiffHunk dataclass."""

    def test_diff_hunk_creation(self):
        """Test DiffHunk creation."""
        from src.changes.manager import DiffHunk, HunkStatus

        hunk = DiffHunk(
            id="hunk-123",
            old_start=1,
            old_lines=5,
            new_start=1,
            new_lines=7,
            lines=[],
        )
        assert hunk.id == "hunk-123"
        assert hunk.old_start == 1
        assert hunk.old_lines == 5
        assert hunk.status == HunkStatus.SELECTED  # Default

    def test_diff_hunk_with_custom_status(self):
        """Test DiffHunk with custom status."""
        from src.changes.manager import DiffHunk, DiffLine, HunkStatus

        lines = [
            DiffLine(type="remove", content="old", old_line_number=1),
            DiffLine(type="add", content="new", new_line_number=1),
        ]
        hunk = DiffHunk(
            id="hunk-456",
            old_start=1,
            old_lines=1,
            new_start=1,
            new_lines=1,
            lines=lines,
            status=HunkStatus.PENDING,
        )
        assert len(hunk.lines) == 2
        assert hunk.status == HunkStatus.PENDING


class TestFileChangeDataclass:
    """Test FileChange dataclass."""

    def test_file_change_creation(self):
        """Test FileChange creation."""
        from src.changes.manager import FileChange, ChangeType

        change = FileChange(
            path="src/test.py",
            change_type=ChangeType.MODIFY,
            hunks=[],
            content_before="old content",
            content_after="new content",
        )
        assert change.path == "src/test.py"
        assert change.change_type == ChangeType.MODIFY

    def test_file_change_additions_property(self):
        """Test FileChange additions property."""
        from src.changes.manager import FileChange, ChangeType, DiffHunk, DiffLine

        lines = [
            DiffLine(type="add", content="line1", new_line_number=1),
            DiffLine(type="add", content="line2", new_line_number=2),
            DiffLine(type="context", content="line3", old_line_number=1, new_line_number=3),
        ]
        hunk = DiffHunk(id="h1", old_start=1, old_lines=1, new_start=1, new_lines=3, lines=lines)
        change = FileChange(path="test.py", change_type=ChangeType.MODIFY, hunks=[hunk])
        assert change.additions == 2

    def test_file_change_deletions_property(self):
        """Test FileChange deletions property."""
        from src.changes.manager import FileChange, ChangeType, DiffHunk, DiffLine

        lines = [
            DiffLine(type="remove", content="line1", old_line_number=1),
            DiffLine(type="remove", content="line2", old_line_number=2),
        ]
        hunk = DiffHunk(id="h1", old_start=1, old_lines=2, new_start=1, new_lines=0, lines=lines)
        change = FileChange(path="test.py", change_type=ChangeType.DELETE, hunks=[hunk])
        assert change.deletions == 2


class TestChangeSetDataclass:
    """Test ChangeSet dataclass."""

    def test_change_set_creation(self):
        """Test ChangeSet creation."""
        from src.changes.manager import ChangeSet

        cs = ChangeSet(
            id="cs-123",
            session_id="session-456",
            agent_id="agent-789",
            agent_name="coder",
            description="Fixed bug",
            files=[],
        )
        assert cs.id == "cs-123"
        assert cs.session_id == "session-456"
        assert cs.status == "pending"

    def test_change_set_total_properties(self):
        """Test ChangeSet total_files, total_additions, total_deletions."""
        from src.changes.manager import (
            ChangeSet, FileChange, ChangeType, DiffHunk, DiffLine
        )

        lines1 = [DiffLine(type="add", content="line", new_line_number=1)]
        lines2 = [DiffLine(type="remove", content="line", old_line_number=1)]
        hunk1 = DiffHunk(id="h1", old_start=0, old_lines=0, new_start=1, new_lines=1, lines=lines1)
        hunk2 = DiffHunk(id="h2", old_start=1, old_lines=1, new_start=0, new_lines=0, lines=lines2)
        files = [
            FileChange(path="a.py", change_type=ChangeType.CREATE, hunks=[hunk1]),
            FileChange(path="b.py", change_type=ChangeType.DELETE, hunks=[hunk2]),
        ]
        cs = ChangeSet(
            id="cs-1", session_id="s-1", agent_id="a-1",
            agent_name="coder", description="Test", files=files
        )
        assert cs.total_files == 2
        assert cs.total_additions == 1
        assert cs.total_deletions == 1


class TestChangeSetManagerMethods:
    """Test ChangeSetManager class methods."""

    @pytest.fixture
    def manager(self):
        """Create a new ChangeSetManager."""
        from src.changes.manager import ChangeSetManager
        return ChangeSetManager()

    def test_create_change_set(self, manager):
        """Test create_change_set method."""
        cs = manager.create_change_set(
            session_id="session-123",
            agent_id="agent-456",
            agent_name="coder",
            description="Test changes",
        )
        assert cs.session_id == "session-123"
        assert cs.agent_id == "agent-456"
        assert cs.files == []

    def test_get_change_set(self, manager):
        """Test get_change_set method."""
        cs = manager.create_change_set("session-1", "agent-1", "coder", "Test")
        retrieved = manager.get_change_set(cs.id)
        assert retrieved == cs

    def test_get_change_set_not_found(self, manager):
        """Test get_change_set with non-existent ID."""
        result = manager.get_change_set("non-existent")
        assert result is None

    def test_add_file_change(self, manager):
        """Test add_file_change method."""
        from src.changes.manager import ChangeType

        cs = manager.create_change_set("session-1", "agent-1", "coder", "Test")
        file_change = manager.add_file_change(
            cs.id, "test.py", ChangeType.MODIFY, "old\n", "new\n"
        )
        assert file_change is not None
        assert file_change.path == "test.py"
        assert len(cs.files) == 1

    def test_add_file_change_invalid_changeset(self, manager):
        """Test add_file_change with invalid change set ID."""
        from src.changes.manager import ChangeType

        result = manager.add_file_change("invalid", "test.py", ChangeType.CREATE, None, "content")
        assert result is None

    def test_get_session_changes(self, manager):
        """Test get_session_changes method."""
        cs1 = manager.create_change_set("session-1", "agent-1", "coder", "Change 1")
        cs2 = manager.create_change_set("session-1", "agent-2", "reviewer", "Change 2")
        cs3 = manager.create_change_set("session-2", "agent-3", "coder", "Change 3")

        session1_changes = manager.get_session_changes("session-1")
        assert len(session1_changes) == 2
        assert cs1 in session1_changes
        assert cs2 in session1_changes

    def test_get_session_changes_with_status_filter(self, manager):
        """Test get_session_changes with status filter."""
        cs1 = manager.create_change_set("session-1", "agent-1", "coder", "Change 1")
        cs2 = manager.create_change_set("session-1", "agent-2", "coder", "Change 2")
        cs2.status = "applied"

        pending = manager.get_session_changes("session-1", status="pending")
        assert len(pending) == 1
        assert cs1 in pending

    def test_get_session_changes_empty(self, manager):
        """Test get_session_changes for non-existent session."""
        changes = manager.get_session_changes("non-existent")
        assert changes == []

    def test_update_hunk_status(self, manager):
        """Test update_hunk_status method."""
        from src.changes.manager import ChangeType, HunkStatus

        cs = manager.create_change_set("session-1", "agent-1", "coder", "Test")
        manager.add_file_change(cs.id, "test.py", ChangeType.MODIFY, "old\n", "new\n")
        hunk_id = cs.files[0].hunks[0].id

        result = manager.update_hunk_status(cs.id, "test.py", hunk_id, HunkStatus.REJECTED)
        assert result is True
        assert cs.files[0].hunks[0].status == HunkStatus.REJECTED

    def test_update_hunk_status_invalid_changeset(self, manager):
        """Test update_hunk_status with invalid change set."""
        from src.changes.manager import HunkStatus

        result = manager.update_hunk_status("invalid", "test.py", "hunk-1", HunkStatus.SELECTED)
        assert result is False

    def test_update_hunk_status_invalid_file(self, manager):
        """Test update_hunk_status with invalid file path."""
        from src.changes.manager import ChangeType, HunkStatus

        cs = manager.create_change_set("session-1", "agent-1", "coder", "Test")
        manager.add_file_change(cs.id, "test.py", ChangeType.MODIFY, "old\n", "new\n")

        result = manager.update_hunk_status(cs.id, "wrong.py", "hunk-1", HunkStatus.SELECTED)
        assert result is False

    def test_update_hunk_status_invalid_hunk(self, manager):
        """Test update_hunk_status with invalid hunk ID."""
        from src.changes.manager import ChangeType, HunkStatus

        cs = manager.create_change_set("session-1", "agent-1", "coder", "Test")
        manager.add_file_change(cs.id, "test.py", ChangeType.MODIFY, "old\n", "new\n")

        result = manager.update_hunk_status(cs.id, "test.py", "invalid-hunk", HunkStatus.SELECTED)
        assert result is False

    def test_apply_change_set(self, manager):
        """Test apply_change_set method."""
        from src.changes.manager import ChangeType

        cs = manager.create_change_set("session-1", "agent-1", "coder", "Test")
        manager.add_file_change(cs.id, "test.py", ChangeType.MODIFY, "old\n", "new\n")

        result = manager.apply_change_set(cs.id)
        assert result["success"] is True
        assert result["change_set_id"] == cs.id
        assert cs.status == "applied"

    def test_apply_change_set_with_selected_hunks(self, manager):
        """Test apply_change_set with specific hunks."""
        from src.changes.manager import ChangeType

        cs = manager.create_change_set("session-1", "agent-1", "coder", "Test")
        manager.add_file_change(cs.id, "test.py", ChangeType.MODIFY, "old\n", "new\n")
        hunk_id = cs.files[0].hunks[0].id

        result = manager.apply_change_set(cs.id, {"test.py": [hunk_id]})
        assert result["success"] is True

    def test_apply_change_set_not_found(self, manager):
        """Test apply_change_set with invalid ID."""
        result = manager.apply_change_set("non-existent")
        assert result["success"] is False
        assert "not found" in result["error"]

    def test_reject_change_set(self, manager):
        """Test reject_change_set method."""
        cs = manager.create_change_set("session-1", "agent-1", "coder", "Test")
        result = manager.reject_change_set(cs.id)
        assert result is True
        assert cs.status == "rejected"

    def test_reject_change_set_not_found(self, manager):
        """Test reject_change_set with invalid ID."""
        result = manager.reject_change_set("non-existent")
        assert result is False

    def test_clear_session(self, manager):
        """Test clear_session method."""
        manager.create_change_set("session-1", "agent-1", "coder", "Test 1")
        manager.create_change_set("session-1", "agent-2", "coder", "Test 2")
        manager.create_change_set("session-2", "agent-3", "coder", "Test 3")

        manager.clear_session("session-1")
        assert manager.get_session_changes("session-1") == []
        assert len(manager.get_session_changes("session-2")) == 1

    def test_clear_session_nonexistent(self, manager):
        """Test clear_session with non-existent session."""
        # Should not raise
        manager.clear_session("non-existent")

    def test_get_aggregated_changes(self, manager):
        """Test get_aggregated_changes method."""
        from src.changes.manager import ChangeType

        cs1 = manager.create_change_set("session-1", "agent-1", "coder", "Fix 1")
        manager.add_file_change(cs1.id, "test.py", ChangeType.MODIFY, "old\n", "new\n")

        cs2 = manager.create_change_set("session-1", "agent-2", "reviewer", "Fix 2")
        manager.add_file_change(cs2.id, "other.py", ChangeType.CREATE, None, "content\n")

        result = manager.get_aggregated_changes("session-1")
        assert result["session_id"] == "session-1"
        assert result["total_files"] == 2
        assert result["total_change_sets"] == 2


class TestGenerateHunks:
    """Test _generate_hunks method."""

    @pytest.fixture
    def manager(self):
        """Create a new ChangeSetManager."""
        from src.changes.manager import ChangeSetManager
        return ChangeSetManager()

    def test_generate_hunks_no_content(self, manager):
        """Test _generate_hunks with no content."""
        hunks = manager._generate_hunks(None, None)
        assert hunks == []

    def test_generate_hunks_same_content(self, manager):
        """Test _generate_hunks with identical content."""
        content = "line 1\nline 2\n"
        hunks = manager._generate_hunks(content, content)
        assert hunks == []

    def test_generate_hunks_added_lines(self, manager):
        """Test _generate_hunks with added lines."""
        before = "line 1\n"
        after = "line 1\nline 2\n"
        hunks = manager._generate_hunks(before, after)
        assert len(hunks) >= 1

    def test_generate_hunks_removed_lines(self, manager):
        """Test _generate_hunks with removed lines."""
        before = "line 1\nline 2\n"
        after = "line 1\n"
        hunks = manager._generate_hunks(before, after)
        assert len(hunks) >= 1


class TestHunksOverlap:
    """Test _hunks_overlap method."""

    @pytest.fixture
    def manager(self):
        """Create a new ChangeSetManager."""
        from src.changes.manager import ChangeSetManager
        return ChangeSetManager()

    def test_hunks_overlap_true(self, manager):
        """Test overlapping hunks."""
        hunk1 = {"old_start": 1, "old_lines": 10}
        hunk2 = {"old_start": 5, "old_lines": 10}
        assert manager._hunks_overlap(hunk1, hunk2) is True

    def test_hunks_overlap_false(self, manager):
        """Test non-overlapping hunks."""
        hunk1 = {"old_start": 1, "old_lines": 5}
        hunk2 = {"old_start": 10, "old_lines": 5}
        assert manager._hunks_overlap(hunk1, hunk2) is False

    def test_hunks_overlap_adjacent(self, manager):
        """Test adjacent hunks (not overlapping)."""
        hunk1 = {"old_start": 1, "old_lines": 5}
        hunk2 = {"old_start": 6, "old_lines": 5}
        assert manager._hunks_overlap(hunk1, hunk2) is False


class TestGetChangeSetManagerGlobal:
    """Test get_change_set_manager function."""

    def test_get_change_set_manager_singleton(self):
        """Test that get_change_set_manager returns same instance."""
        from src.changes.manager import get_change_set_manager, ChangeSetManager
        import src.changes.manager as module

        # Reset global
        module._manager = None

        manager1 = get_change_set_manager()
        manager2 = get_change_set_manager()
        assert manager1 is manager2
        assert isinstance(manager1, ChangeSetManager)

        # Clean up
        module._manager = None
