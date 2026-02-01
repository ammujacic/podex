"""Change set management for aggregated diff views.

This module tracks pending file changes from agents, allowing users to
review, accept, or reject changes in bulk before they're applied.
"""

import difflib
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any


class ChangeType(str, Enum):
    """Type of file change."""

    CREATE = "create"
    MODIFY = "modify"
    DELETE = "delete"


class HunkStatus(str, Enum):
    """Selection status of a diff hunk."""

    PENDING = "pending"
    SELECTED = "selected"
    REJECTED = "rejected"


@dataclass
class DiffLine:
    """A single line in a diff."""

    type: str  # 'context', 'add', 'remove'
    content: str
    old_line_number: int | None = None
    new_line_number: int | None = None


@dataclass
class DiffHunk:
    """A contiguous block of changes in a diff."""

    id: str
    old_start: int
    old_lines: int
    new_start: int
    new_lines: int
    lines: list[DiffLine]
    status: HunkStatus = HunkStatus.SELECTED


@dataclass
class FileChange:
    """A change to a single file."""

    path: str
    change_type: ChangeType
    hunks: list[DiffHunk]
    content_before: str | None = None
    content_after: str | None = None

    @property
    def additions(self) -> int:
        """Count of added lines."""
        return sum(sum(1 for line in hunk.lines if line.type == "add") for hunk in self.hunks)

    @property
    def deletions(self) -> int:
        """Count of removed lines."""
        return sum(sum(1 for line in hunk.lines if line.type == "remove") for hunk in self.hunks)


@dataclass
class ChangeSet:
    """A collection of file changes from an agent."""

    id: str
    session_id: str
    agent_id: str
    agent_name: str
    description: str
    files: list[FileChange]
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    status: str = "pending"  # pending, applied, rejected

    @property
    def total_files(self) -> int:
        return len(self.files)

    @property
    def total_additions(self) -> int:
        return sum(f.additions for f in self.files)

    @property
    def total_deletions(self) -> int:
        return sum(f.deletions for f in self.files)


class ChangeSetManager:
    """
    Manages pending changes across multiple agents in a session.

    This allows for:
    - Aggregating all pending changes for review
    - Per-hunk selection for partial acceptance
    - Conflict detection between overlapping changes
    """

    def __init__(self) -> None:
        # Session ID -> list of change sets
        self._change_sets: dict[str, list[ChangeSet]] = {}

    def create_change_set(
        self,
        session_id: str,
        agent_id: str,
        agent_name: str,
        description: str,
    ) -> ChangeSet:
        """Create a new empty change set for an agent."""
        change_set = ChangeSet(
            id=str(uuid.uuid4()),
            session_id=session_id,
            agent_id=agent_id,
            agent_name=agent_name,
            description=description,
            files=[],
        )

        if session_id not in self._change_sets:
            self._change_sets[session_id] = []
        self._change_sets[session_id].append(change_set)

        return change_set

    def add_file_change(
        self,
        change_set_id: str,
        path: str,
        change_type: ChangeType,
        content_before: str | None,
        content_after: str | None,
    ) -> FileChange | None:
        """Add a file change to an existing change set."""
        change_set = self._find_change_set(change_set_id)
        if not change_set:
            return None

        # Generate diff hunks
        hunks = self._generate_hunks(content_before, content_after)

        file_change = FileChange(
            path=path,
            change_type=change_type,
            hunks=hunks,
            content_before=content_before,
            content_after=content_after,
        )

        change_set.files.append(file_change)
        return file_change

    def get_session_changes(
        self,
        session_id: str,
        status: str | None = None,
    ) -> list[ChangeSet]:
        """Get all change sets for a session."""
        change_sets = self._change_sets.get(session_id, [])
        if status:
            change_sets = [cs for cs in change_sets if cs.status == status]
        return change_sets

    def get_change_set(self, change_set_id: str) -> ChangeSet | None:
        """Get a specific change set by ID."""
        return self._find_change_set(change_set_id)

    def get_aggregated_changes(
        self,
        session_id: str,
    ) -> dict[str, Any]:
        """
        Get all pending changes aggregated by file.

        Returns a structure suitable for the aggregated diff view,
        with file changes from all agents grouped together.
        """
        pending = self.get_session_changes(session_id, status="pending")

        # Aggregate by file path
        files_by_path: dict[str, list[dict[str, Any]]] = {}

        for change_set in pending:
            for file_change in change_set.files:
                if file_change.path not in files_by_path:
                    files_by_path[file_change.path] = []

                files_by_path[file_change.path].append(
                    {
                        "change_set_id": change_set.id,
                        "agent_id": change_set.agent_id,
                        "agent_name": change_set.agent_name,
                        "change_type": file_change.change_type.value,
                        "hunks": [
                            {
                                "id": h.id,
                                "old_start": h.old_start,
                                "old_lines": h.old_lines,
                                "new_start": h.new_start,
                                "new_lines": h.new_lines,
                                "status": h.status.value,
                                "lines": [
                                    {
                                        "type": line.type,
                                        "content": line.content,
                                        "old_line_number": line.old_line_number,
                                        "new_line_number": line.new_line_number,
                                    }
                                    for line in h.lines
                                ],
                            }
                            for h in file_change.hunks
                        ],
                        "additions": file_change.additions,
                        "deletions": file_change.deletions,
                    }
                )

        # Check for conflicts
        conflicts = self._detect_conflicts(files_by_path)

        return {
            "session_id": session_id,
            "files": files_by_path,
            "total_files": len(files_by_path),
            "total_change_sets": len(pending),
            "conflicts": conflicts,
        }

    def update_hunk_status(
        self,
        change_set_id: str,
        file_path: str,
        hunk_id: str,
        status: HunkStatus,
    ) -> bool:
        """Update the selection status of a specific hunk."""
        change_set = self._find_change_set(change_set_id)
        if not change_set:
            return False

        for file_change in change_set.files:
            if file_change.path == file_path:
                for hunk in file_change.hunks:
                    if hunk.id == hunk_id:
                        hunk.status = status
                        return True

        return False

    def apply_change_set(
        self,
        change_set_id: str,
        selected_hunks: dict[str, list[str]] | None = None,
    ) -> dict[str, Any]:
        """
        Apply a change set (or selected hunks from it).

        Args:
            change_set_id: The change set to apply
            selected_hunks: Optional dict of {file_path: [hunk_ids]} to apply
                          If None, applies all selected hunks

        Returns:
            Summary of applied changes
        """
        change_set = self._find_change_set(change_set_id)
        if not change_set:
            return {"success": False, "error": "Change set not found"}

        applied_files = []

        for file_change in change_set.files:
            # Determine which hunks to apply
            if selected_hunks:
                hunk_ids = selected_hunks.get(file_change.path, [])
                hunks_to_apply = [h for h in file_change.hunks if h.id in hunk_ids]
            else:
                hunks_to_apply = [h for h in file_change.hunks if h.status == HunkStatus.SELECTED]

            if hunks_to_apply:
                applied_files.append(
                    {
                        "path": file_change.path,
                        "change_type": file_change.change_type.value,
                        "hunks_applied": len(hunks_to_apply),
                    }
                )

        change_set.status = "applied"

        return {
            "success": True,
            "change_set_id": change_set_id,
            "files_applied": len(applied_files),
            "details": applied_files,
        }

    def reject_change_set(self, change_set_id: str) -> bool:
        """Reject an entire change set."""
        change_set = self._find_change_set(change_set_id)
        if not change_set:
            return False

        change_set.status = "rejected"
        return True

    def clear_session(self, session_id: str) -> None:
        """Clear all change sets for a session."""
        if session_id in self._change_sets:
            del self._change_sets[session_id]

    def _find_change_set(self, change_set_id: str) -> ChangeSet | None:
        """Find a change set by ID across all sessions."""
        for change_sets in self._change_sets.values():
            for cs in change_sets:
                if cs.id == change_set_id:
                    return cs
        return None

    def _generate_hunks(
        self,
        content_before: str | None,
        content_after: str | None,
    ) -> list[DiffHunk]:
        """Generate diff hunks from before/after content."""
        if content_before is None:
            content_before = ""
        if content_after is None:
            content_after = ""

        before_lines = content_before.splitlines(keepends=True)
        after_lines = content_after.splitlines(keepends=True)

        # Use unified diff to generate hunks
        diff = list(
            difflib.unified_diff(
                before_lines,
                after_lines,
                lineterm="",
            )
        )

        if len(diff) < 3:
            # No differences or minimal changes
            return []

        hunks = []
        current_hunk: DiffHunk | None = None
        old_line = 0
        new_line = 0

        for line in diff[2:]:  # Skip --- and +++ lines
            if line.startswith("@@"):
                # Parse hunk header
                # Format: @@ -old_start,old_lines +new_start,new_lines @@
                parts = line.split()
                old_range = parts[1][1:].split(",")
                new_range = parts[2][1:].split(",")

                old_start = int(old_range[0])
                old_lines = int(old_range[1]) if len(old_range) > 1 else 1
                new_start = int(new_range[0])
                new_lines = int(new_range[1]) if len(new_range) > 1 else 1

                if current_hunk:
                    hunks.append(current_hunk)

                current_hunk = DiffHunk(
                    id=str(uuid.uuid4()),
                    old_start=old_start,
                    old_lines=old_lines,
                    new_start=new_start,
                    new_lines=new_lines,
                    lines=[],
                )
                old_line = old_start
                new_line = new_start
            elif current_hunk:
                content = line[1:] if line else ""

                if line.startswith("+"):
                    current_hunk.lines.append(
                        DiffLine(
                            type="add",
                            content=content.rstrip("\n"),
                            new_line_number=new_line,
                        )
                    )
                    new_line += 1
                elif line.startswith("-"):
                    current_hunk.lines.append(
                        DiffLine(
                            type="remove",
                            content=content.rstrip("\n"),
                            old_line_number=old_line,
                        )
                    )
                    old_line += 1
                else:
                    current_hunk.lines.append(
                        DiffLine(
                            type="context",
                            content=content.rstrip("\n"),
                            old_line_number=old_line,
                            new_line_number=new_line,
                        )
                    )
                    old_line += 1
                    new_line += 1

        if current_hunk:
            hunks.append(current_hunk)

        return hunks

    def _detect_conflicts(
        self,
        files_by_path: dict[str, list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        """Detect conflicts between overlapping changes."""
        conflicts = []

        for path, changes in files_by_path.items():
            if len(changes) > 1:
                # Multiple agents changed the same file
                # Check if hunks overlap
                for i, change1 in enumerate(changes):
                    for change2 in changes[i + 1 :]:
                        for hunk1 in change1["hunks"]:
                            for hunk2 in change2["hunks"]:
                                if self._hunks_overlap(hunk1, hunk2):
                                    conflicts.append(
                                        {
                                            "file_path": path,
                                            "agent1": change1["agent_name"],
                                            "agent2": change2["agent_name"],
                                            "hunk1_id": hunk1["id"],
                                            "hunk2_id": hunk2["id"],
                                        }
                                    )

        return conflicts

    def _hunks_overlap(self, hunk1: dict[str, Any], hunk2: dict[str, Any]) -> bool:
        """Check if two hunks affect overlapping line ranges."""
        start1, end1 = hunk1["old_start"], hunk1["old_start"] + hunk1["old_lines"]
        start2, end2 = hunk2["old_start"], hunk2["old_start"] + hunk2["old_lines"]

        return not (end1 <= start2 or end2 <= start1)


# Global instance for the agent service
_manager: ChangeSetManager | None = None


def get_change_set_manager() -> ChangeSetManager:
    """Get or create the global change set manager instance."""
    global _manager
    if _manager is None:
        _manager = ChangeSetManager()
    return _manager
