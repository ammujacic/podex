"""Conflict detection for parallel agent execution."""

import difflib
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

import structlog

logger = structlog.get_logger()


class ConflictType(str, Enum):
    """Type of conflict between parallel agents."""

    FILE_OVERLAP = "file_overlap"  # Multiple agents editing same file
    LINE_CONFLICT = "line_conflict"  # Same lines being modified
    SEMANTIC_CONFLICT = "semantic_conflict"  # Conflicting logic changes
    RESOURCE_CONFLICT = "resource_conflict"  # Same resource being used


class ConflictSeverity(str, Enum):
    """Severity of a detected conflict."""

    LOW = "low"  # Minor overlap, likely auto-resolvable
    MEDIUM = "medium"  # Some manual review needed
    HIGH = "high"  # Significant conflict, requires intervention
    CRITICAL = "critical"  # Blocking conflict, cannot proceed


@dataclass
class FileChange:
    """A change made to a file by an agent."""

    agent_id: str
    file_path: str
    change_type: str  # "create", "modify", "delete"
    lines_added: list[int]
    lines_removed: list[int]
    content_before: str | None = None
    content_after: str | None = None
    timestamp: datetime = field(default_factory=datetime.utcnow)


@dataclass
class Conflict:
    """A detected conflict between agents."""

    id: str
    conflict_type: ConflictType
    severity: ConflictSeverity
    file_path: str
    agent_ids: list[str]
    description: str
    affected_lines: list[int] = field(default_factory=list)
    suggested_resolution: str | None = None
    auto_resolvable: bool = False
    detected_at: datetime = field(default_factory=datetime.utcnow)
    resolved: bool = False
    resolution_method: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "conflict_type": self.conflict_type.value,
            "severity": self.severity.value,
            "file_path": self.file_path,
            "agent_ids": self.agent_ids,
            "description": self.description,
            "affected_lines": self.affected_lines,
            "suggested_resolution": self.suggested_resolution,
            "auto_resolvable": self.auto_resolvable,
            "detected_at": self.detected_at.isoformat(),
            "resolved": self.resolved,
            "resolution_method": self.resolution_method,
        }


class FileConflictDetector:
    """
    Detects conflicts between parallel agents.

    Features:
    - Real-time file change tracking
    - Line-level conflict detection
    - Conflict severity assessment
    - Suggested resolutions
    - Auto-resolution for simple cases
    """

    def __init__(self) -> None:
        # Track changes by session
        self._changes: dict[str, list[FileChange]] = {}  # session_id -> changes
        # Track conflicts by session
        self._conflicts: dict[str, list[Conflict]] = {}  # session_id -> conflicts
        # Conflict ID counter
        self._conflict_counter = 0

    def track_change(
        self,
        session_id: str,
        agent_id: str,
        file_path: str,
        change_type: str,
        content_before: str | None = None,
        content_after: str | None = None,
    ) -> list[Conflict]:
        """
        Track a file change and detect any conflicts.

        Returns:
            List of newly detected conflicts
        """
        # Calculate affected lines
        lines_added, lines_removed = self._compute_line_changes(content_before, content_after)

        change = FileChange(
            agent_id=agent_id,
            file_path=file_path,
            change_type=change_type,
            lines_added=lines_added,
            lines_removed=lines_removed,
            content_before=content_before,
            content_after=content_after,
        )

        # Store change
        if session_id not in self._changes:
            self._changes[session_id] = []
        self._changes[session_id].append(change)

        # Detect conflicts with other agents
        new_conflicts = self._detect_conflicts(session_id, change)

        return new_conflicts

    def _compute_line_changes(
        self,
        content_before: str | None,
        content_after: str | None,
    ) -> tuple[list[int], list[int]]:
        """Compute which lines were added and removed."""
        if not content_before and not content_after:
            return [], []

        lines_before = (content_before or "").splitlines()
        lines_after = (content_after or "").splitlines()

        added: list[int] = []
        removed: list[int] = []

        matcher = difflib.SequenceMatcher(None, lines_before, lines_after)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "delete":
                removed.extend(range(i1 + 1, i2 + 1))
            elif tag == "insert":
                added.extend(range(j1 + 1, j2 + 1))
            elif tag == "replace":
                removed.extend(range(i1 + 1, i2 + 1))
                added.extend(range(j1 + 1, j2 + 1))

        return added, removed

    def _detect_conflicts(
        self,
        session_id: str,
        new_change: FileChange,
    ) -> list[Conflict]:
        """Detect conflicts between the new change and existing changes."""
        conflicts = []
        changes = self._changes.get(session_id, [])

        for existing in changes:
            if existing.agent_id == new_change.agent_id:
                continue

            if existing.file_path != new_change.file_path:
                continue

            # Same file being modified by different agents
            conflict = self._analyze_conflict(existing, new_change)
            if conflict:
                self._conflict_counter += 1
                conflict.id = f"conflict-{self._conflict_counter}"

                if session_id not in self._conflicts:
                    self._conflicts[session_id] = []
                self._conflicts[session_id].append(conflict)
                conflicts.append(conflict)

                logger.warning(
                    "conflict_detected",
                    conflict_id=conflict.id,
                    file=conflict.file_path,
                    agents=conflict.agent_ids,
                    severity=conflict.severity.value,
                )

        return conflicts

    def _analyze_conflict(
        self,
        change_a: FileChange,
        change_b: FileChange,
    ) -> Conflict | None:
        """Analyze two changes and determine if they conflict."""
        # Check for line-level conflicts
        lines_a = set(change_a.lines_added + change_a.lines_removed)
        lines_b = set(change_b.lines_added + change_b.lines_removed)
        overlapping_lines = lines_a & lines_b

        if overlapping_lines:
            # Line-level conflict
            severity = self._assess_severity(len(overlapping_lines), change_a, change_b)
            return Conflict(
                id="",  # Will be set later
                conflict_type=ConflictType.LINE_CONFLICT,
                severity=severity,
                file_path=change_a.file_path,
                agent_ids=[change_a.agent_id, change_b.agent_id],
                description=(
                    f"Both agents modified lines {sorted(overlapping_lines)[:5]}"
                    f"{'...' if len(overlapping_lines) > 5 else ''}"
                ),
                affected_lines=sorted(overlapping_lines),
                suggested_resolution=self._suggest_resolution(
                    change_a, change_b, overlapping_lines
                ),
                auto_resolvable=len(overlapping_lines) <= 3 and severity == ConflictSeverity.LOW,
            )

        elif lines_a or lines_b:
            # File overlap but no line conflict - lower severity
            return Conflict(
                id="",
                conflict_type=ConflictType.FILE_OVERLAP,
                severity=ConflictSeverity.LOW,
                file_path=change_a.file_path,
                agent_ids=[change_a.agent_id, change_b.agent_id],
                description=f"Both agents modified {change_a.file_path} (different sections)",
                suggested_resolution="Changes can likely be merged automatically",
                auto_resolvable=True,
            )

        return None

    def _assess_severity(
        self,
        overlap_count: int,
        change_a: FileChange,
        change_b: FileChange,
    ) -> ConflictSeverity:
        """Assess the severity of a conflict."""
        # More overlapping lines = higher severity
        if overlap_count > 20:
            return ConflictSeverity.HIGH
        elif overlap_count > 10:
            return ConflictSeverity.MEDIUM
        elif overlap_count > 3:
            return ConflictSeverity.LOW

        # Check if both are deleting the same code
        if set(change_a.lines_removed) & set(change_b.lines_removed):
            return ConflictSeverity.MEDIUM

        return ConflictSeverity.LOW

    def _suggest_resolution(
        self,
        change_a: FileChange,
        change_b: FileChange,
        overlapping_lines: set[int],
    ) -> str:
        """Suggest a resolution for a conflict."""
        # Simple heuristics for resolution suggestions
        if len(overlapping_lines) <= 3:
            return "Review the small overlap and choose the preferred version"

        a_adds = len(change_a.lines_added)
        b_adds = len(change_b.lines_added)
        a_removes = len(change_a.lines_removed)
        b_removes = len(change_b.lines_removed)

        if a_removes > a_adds and b_adds > b_removes:
            return (
                f"Agent {change_a.agent_id[:8]} is removing code while "
                f"Agent {change_b.agent_id[:8]} is adding. Consider keeping additions."
            )

        if a_adds > a_removes and b_adds > b_removes:
            return "Both agents are adding code. Consider merging both additions if compatible."

        return "Manual review recommended to resolve conflicting changes"

    def get_session_conflicts(
        self,
        session_id: str,
        include_resolved: bool = False,
    ) -> list[Conflict]:
        """Get all conflicts for a session."""
        conflicts = self._conflicts.get(session_id, [])
        if not include_resolved:
            conflicts = [c for c in conflicts if not c.resolved]
        return conflicts

    def get_agent_conflicts(
        self,
        session_id: str,
        agent_id: str,
    ) -> list[Conflict]:
        """Get conflicts involving a specific agent."""
        conflicts = self._conflicts.get(session_id, [])
        return [c for c in conflicts if agent_id in c.agent_ids]

    def get_file_conflicts(
        self,
        session_id: str,
        file_path: str,
    ) -> list[Conflict]:
        """Get conflicts for a specific file."""
        conflicts = self._conflicts.get(session_id, [])
        return [c for c in conflicts if c.file_path == file_path]

    def resolve_conflict(
        self,
        conflict_id: str,
        resolution_method: str,
    ) -> bool:
        """Mark a conflict as resolved."""
        for conflicts in self._conflicts.values():
            for conflict in conflicts:
                if conflict.id == conflict_id:
                    conflict.resolved = True
                    conflict.resolution_method = resolution_method
                    logger.info(
                        "conflict_resolved",
                        conflict_id=conflict_id,
                        method=resolution_method,
                    )
                    return True
        return False

    def get_conflict_summary(self, session_id: str) -> dict[str, Any]:
        """Get a summary of conflicts for a session."""
        conflicts = self._conflicts.get(session_id, [])
        unresolved = [c for c in conflicts if not c.resolved]

        return {
            "total": len(conflicts),
            "unresolved": len(unresolved),
            "by_severity": {
                "critical": sum(1 for c in unresolved if c.severity == ConflictSeverity.CRITICAL),
                "high": sum(1 for c in unresolved if c.severity == ConflictSeverity.HIGH),
                "medium": sum(1 for c in unresolved if c.severity == ConflictSeverity.MEDIUM),
                "low": sum(1 for c in unresolved if c.severity == ConflictSeverity.LOW),
            },
            "auto_resolvable": sum(1 for c in unresolved if c.auto_resolvable),
            "files_affected": list(set(c.file_path for c in unresolved)),
        }

    def clear_session(self, session_id: str) -> None:
        """Clear all changes and conflicts for a session."""
        self._changes.pop(session_id, None)
        self._conflicts.pop(session_id, None)


# Global instance
_detector: FileConflictDetector | None = None


def get_conflict_detector() -> FileConflictDetector:
    """Get or create the global conflict detector."""
    global _detector
    if _detector is None:
        _detector = FileConflictDetector()
    return _detector
